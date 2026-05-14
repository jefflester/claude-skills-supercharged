#!/usr/bin/env node
/**
 * Intent analysis orchestrator
 *
 * Coordinates AI-powered intent analysis using modular components:
 * - AI provider client for skill scoring
 * - Cache manager for result persistence
 * - Keyword matcher for fallback
 * - Intent scorer for categorization
 */

import { createHash } from 'crypto';
import { SHORT_PROMPT_WORD_THRESHOLD, DEBUG_ENABLED, FALLBACK_DOMAIN_MODE } from './constants.js';
import { isPersistentCacheEnabled, readCache, writeCache } from './cache-manager.js';
import { callAIForIntentAnalysis, getModel, getProvider } from './ai-client.js';
import { matchSkillsByKeywords } from './keyword-matcher.js';
import { debugLog } from './debug-logger.js';
import {
  categorizeSkills,
  categorizeCommands,
  formatDebugOutput,
  buildAnalysisResult,
} from './intent-scorer.js';
import type { AnalysisResult, CommandRule, SkillRule } from './types.js';

// Re-export types for backward compatibility
export type { SkillConfidence, IntentAnalysis, AnalysisResult } from './types.js';

// Schema version for persistent cache. Bump when cache entry shape changes. v9: migrated hashing from MD5 to SHA-256.
const CACHE_SCHEMA_VERSION = 'full-surface-v9';
const DEFAULT_PLUGIN_VERSION = '1.0.0';
const FALLBACK_METADATA_STOPWORDS = new Set([
  'about',
  'actual',
  'and',
  'for',
  'help',
  'need',
  'needs',
  'the',
  'this',
  'today',
  'using',
  'want',
  'wants',
  'what',
  'when',
  'where',
  'which',
  'workflow',
  'with',
]);

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getPromptTokens(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.replace(/s$/, ''))
    .filter((token) => token.length >= 3);
}

function tokenMatches(promptTokens: string[], value: string): boolean {
  const normalizedValue = normalizeToken(value);
  if (normalizedValue.length < 3 || FALLBACK_METADATA_STOPWORDS.has(normalizedValue)) {
    return false;
  }

  return promptTokens.some(
    (token) =>
      token === normalizedValue ||
      (token.length >= 4 && normalizedValue.startsWith(token)) ||
      (normalizedValue.length >= 4 && token.startsWith(normalizedValue))
  );
}

function scoreCommandFallback(
  promptLower: string,
  promptTokens: string[],
  commandName: string,
  commandRule: CommandRule
): number {
  const commandNameLower = commandName.toLowerCase();
  let score = 0;

  if (promptLower.includes(commandNameLower)) {
    score += 8;
  }

  for (const token of commandNameLower.split(/[-_\s.]+/g)) {
    if (tokenMatches(promptTokens, token)) {
      score += 4;
    }
  }

  const keywordScore = (commandRule.promptTriggers?.keywords || []).reduce((total, keyword) => {
    return total + (tokenMatches(promptTokens, keyword) ? 2 : 0);
  }, 0);
  score += keywordScore;

  const metadataTokens = Array.from(
    new Set(
      [
        commandRule.description || '',
        commandRule.summary || '',
        commandRule.workflowPhase || '',
      ]
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((token) => token.replace(/s$/, ''))
        .filter((token) => token.length >= 4 && !FALLBACK_METADATA_STOPWORDS.has(token))
    )
  ).slice(0, 48);

  let metadataScore = 0;
  for (const token of metadataTokens) {
    if (tokenMatches(promptTokens, token)) {
      metadataScore += 1;
    }
  }
  score += Math.min(metadataScore, 8);

  return score;
}

function commandRuleAsSkillRule(commandRule: CommandRule): SkillRule {
  const commandDescriptionParts = [
    commandRule.description,
    commandRule.workflowPhase ? `Workflow phase: ${commandRule.workflowPhase}` : undefined,
    commandRule.summary ? `Summary: ${commandRule.summary}` : undefined,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

  return {
    type: commandRule.type || 'domain',
    description: commandDescriptionParts.length > 0 ? commandDescriptionParts.join('. ') : undefined,
    autoInject: commandRule.autoInject,
    requiredSkills: commandRule.requiredCommands,
    injectionOrder: commandRule.injectionOrder,
    promptTriggers: commandRule.promptTriggers,
  };
}

function buildCommandMetadataFingerprint(commands: Record<string, CommandRule>): string {
  const metadata = Object.entries(commands)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rule]) => ({
      name,
      description: rule.description || '',
      summary: rule.summary || '',
      workflowPhase: rule.workflowPhase || '',
      type: rule.type || '',
      autoInject: Boolean(rule.autoInject),
      requiredCommands: rule.requiredCommands || [],
      injectionOrder: rule.injectionOrder || 0,
      promptTriggers: rule.promptTriggers || {},
      agent: rule.agent || '',
      source: rule.source || '',
      sourcePath: rule.sourcePath || '',
      subtask: Boolean(rule.subtask),
      model: rule.model || '',
    }));
  return JSON.stringify(metadata);
}

function buildCommandFallback(
  prompt: string,
  availableCommands: Record<string, CommandRule>
): { requiredCommands: string[]; suggestedCommands: string[]; commandScores: Record<string, number> } {
  const commandRules = Object.fromEntries(
    Object.entries(availableCommands).map(([commandName, commandRule]) => [
      commandName,
      commandRuleAsSkillRule(commandRule),
    ])
  );
  const matched = matchSkillsByKeywords(prompt, commandRules);
  const requiredCommands = new Set(matched.required);
  const suggestedCommands = new Set(matched.suggested);
  const commandScores: Record<string, number> = {};
  const promptLower = prompt.toLowerCase();
  const promptTokens = getPromptTokens(prompt);

  for (const [commandName, commandRule] of Object.entries(availableCommands)) {
    if (requiredCommands.has(commandName) || suggestedCommands.has(commandName)) {
      continue;
    }

    const score = scoreCommandFallback(promptLower, promptTokens, commandName, commandRule);
    if (score <= 0) {
      continue;
    }

    commandScores[commandName] = score;

    if (commandRule.autoInject === true) {
      requiredCommands.add(commandName);
      suggestedCommands.delete(commandName);
      continue;
    }

    switch (FALLBACK_DOMAIN_MODE) {
      case 'inject':
        requiredCommands.add(commandName);
        suggestedCommands.delete(commandName);
        break;
      case 'suggest':
        suggestedCommands.add(commandName);
        break;
      case 'off':
      default:
        break;
    }
  }

  return {
    requiredCommands: Array.from(requiredCommands),
    suggestedCommands: Array.from(
      new Set(Array.from(suggestedCommands).filter((commandName) => !requiredCommands.has(commandName)))
    ),
    commandScores,
  };
}

/**
 * Analyzes user intent using AI to determine relevant skills
 *
 * Uses AI provider for intent analysis (configurable via OPENCODE_SKILLS_PROVIDER, default: anthropic)
 * to analyze the user's prompt and assign confidence scores to each skill. Falls back to keyword matching for short prompts
 * (5 words or fewer by default) or if AI analysis fails. Persistent cross-session
 * results are cached only when DYNAMIC_SKILLS_PERSISTENT_CACHE=ON.
 *
 * @param prompt - The user's input prompt to analyze
 * @param availableSkills - Record of skill configurations from skill-rules.json
 * @returns Promise resolving to required/suggested skill lists with optional scores
 *
 * @example
 * const result = await analyzeIntent("Fix authentication service", skillRules);
 * // Returns: { required: ['service-layer-development'], suggested: [], fromCache: false }
 */
export async function analyzeIntent(
  prompt: string,
  availableSkills: Record<string, SkillRule>,
  availableCommands: Record<string, CommandRule> = {}
): Promise<AnalysisResult> {
  // Skip AI analysis for short prompts (saves API calls)
  const wordCount = prompt.trim().split(/\s+/).length;
  if (wordCount <= SHORT_PROMPT_WORD_THRESHOLD) {
    const skillFallback = matchSkillsByKeywords(prompt, availableSkills);
    return {
      ...skillFallback,
      ...buildCommandFallback(prompt, availableCommands),
      fromFallback: true,
    };
  }

  const availableSkillNames = new Set(Object.keys(availableSkills));
  const availableCommandNames = new Set(Object.keys(availableCommands));

  if (availableSkillNames.size === 0 && availableCommandNames.size === 0) {
    return { required: [], suggested: [], requiredCommands: [], suggestedCommands: [], commandScores: {} };
  }

  // Check opt-in persistent cache first. Include the model/scoring dimensions
  // that can change required/suggested categorization across sessions.
  const skillsHash = createHash('sha256')
    .update(JSON.stringify(availableSkills))
    .digest('hex')
    .substring(0, 8);
  const commandsHash = createHash('sha256')
    .update(buildCommandMetadataFingerprint(availableCommands))
    .digest('hex')
    .substring(0, 8);
  const provider = getProvider();
  const promptTemplateHash = createHash('sha256')
    .update(process.env.OPENCODE_SKILLS_PROMPT_TEMPLATE || '')
    .digest('hex')
    .substring(0, 8);
  const cacheDimensions = {
    version: CACHE_SCHEMA_VERSION,
    pluginVersion: process.env.npm_package_version || DEFAULT_PLUGIN_VERSION,
    provider,
    model: getModel(provider),
    skillRequiredThreshold: process.env.SKILL_CONFIDENCE_THRESHOLD || '0.65',
    skillSuggestedThreshold: process.env.SKILL_SUGGESTED_THRESHOLD || '0.50',
    commandRequiredThreshold: process.env.COMMAND_CONFIDENCE_THRESHOLD || '0.90',
    commandSuggestedThreshold: process.env.COMMAND_SUGGESTED_THRESHOLD || '0.70',
    fallbackDomainMode: process.env.OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE || FALLBACK_DOMAIN_MODE,
    promptTemplateHash,
    skillsHash,
    commandsHash,
  };
  const cacheKey = createHash('sha256')
    .update(`${prompt}:${JSON.stringify(cacheDimensions)}`)
    .digest('hex');

  const persistentCacheEnabled = isPersistentCacheEnabled();
  if (persistentCacheEnabled) {
    const cached = readCache(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Call AI provider
  try {
    const analysis = await callAIForIntentAnalysis(prompt, availableSkills, availableCommands);

    // Debug logging
    if (DEBUG_ENABLED) {
      formatDebugOutput(analysis);
    }

    // Categorize by confidence thresholds (immutable filter — no mutation)
    const categorized = categorizeSkills(analysis);
    const categorizedCommands = categorizeCommands(analysis);

    const filteredRequired = categorized.required.filter((name) => availableSkillNames.has(name));
    const filteredSuggested = categorized.suggested.filter(
      (name) => availableSkillNames.has(name) && !filteredRequired.includes(name)
    );
    const filteredRequiredCommands = categorizedCommands.required.filter((name) =>
      availableCommandNames.has(name)
    );
    const filteredSuggestedCommands = categorizedCommands.suggested.filter(
      (name) => availableCommandNames.has(name) && !filteredRequiredCommands.includes(name)
    );

    const uniqueRequired = Array.from(new Set(filteredRequired));
    const uniqueSuggested = Array.from(
      new Set(filteredSuggested.filter((name) => !uniqueRequired.includes(name)))
    );
    const uniqueRequiredCommands = Array.from(new Set(filteredRequiredCommands));
    const uniqueSuggestedCommands = Array.from(
      new Set(filteredSuggestedCommands.filter((name) => !uniqueRequiredCommands.includes(name)))
    );

    // Build command scores from AI analysis
    const commandScores: Record<string, number> = {};
    for (const command of analysis.commands || []) {
      if (availableCommandNames.has(command.name)) {
        commandScores[command.name] = command.confidence;
      }
    }

    // Build base result immutably
    const baseResult = buildAnalysisResult(
      {
        required: uniqueRequired,
        suggested: uniqueSuggested,
        requiredCommands: uniqueRequiredCommands,
        suggestedCommands: uniqueSuggestedCommands,
        commandScores,
      },
      analysis,
      DEBUG_ENABLED
    );

    // Guarantee guardrail skills are included even on long prompts where AI
    // might under-score them. Keyword matcher only returns guardrail skills
    // (autoInject !== false), so this union is safe.
    const keywordHits = matchSkillsByKeywords(prompt, availableSkills);
    const guaranteedRequired = [...baseResult.required];
    for (const skill of keywordHits.required) {
      if (!guaranteedRequired.includes(skill) && !baseResult.suggested.includes(skill)) {
        guaranteedRequired.push(skill);
      }
    }

    const result: AnalysisResult = {
      ...baseResult,
      required: guaranteedRequired,
      requiredCommands: uniqueRequiredCommands,
      suggestedCommands: uniqueSuggestedCommands,
      commandScores,
    };

    if (persistentCacheEnabled) {
      writeCache(cacheKey, {
        required: result.required,
        suggested: result.suggested,
        requiredCommands: result.requiredCommands,
        suggestedCommands: result.suggestedCommands,
        commandScores: result.commandScores,
      });
    }
    return result;
  } catch (error) {
    debugLog(
      `intent-analyzer: AI analysis failed, using fallback. reason=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    const skillFallback = matchSkillsByKeywords(prompt, availableSkills);
    return {
      ...skillFallback,
      ...buildCommandFallback(prompt, availableCommands),
      fromFallback: true,
    };
  }
}

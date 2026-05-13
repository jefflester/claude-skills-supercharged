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
import { SHORT_PROMPT_WORD_THRESHOLD, DEBUG_ENABLED } from './constants.js';
import { readCache, writeCache } from './cache-manager.js';
import { callAIForIntentAnalysis } from './ai-client.js';
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

const COMMON_TRIGGER_STOPWORDS = new Set([
  'about',
  'actual',
  'daily',
  'help',
  'need',
  'needs',
  'today',
  'user',
  'using',
  'want',
  'wants',
  'what',
  'when',
  'where',
  'which',
  'workflow',
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

function tokenMatches(promptTokens: string[], keyword: string): boolean {
  const normalizedKeyword = normalizeToken(keyword);
  if (normalizedKeyword.length < 3 || COMMON_TRIGGER_STOPWORDS.has(normalizedKeyword)) {
    return false;
  }

  return promptTokens.some(
    (token) =>
      token === normalizedKeyword ||
      (token.length >= 4 && normalizedKeyword.startsWith(token)) ||
      (normalizedKeyword.length >= 4 && token.startsWith(normalizedKeyword))
  );
}

function scoreCandidateSkill(
  prompt: string,
  promptTokens: string[],
  skillName: string,
  skillRule: SkillRule
): number {
  const promptLower = prompt.toLowerCase();
  const skillNameLower = skillName.toLowerCase();
  const frameworkTokens = [
    'android',
    'django',
    'fastapi',
    'flutter',
    'java',
    'kotlin',
    'laravel',
    'nestjs',
    'nextjs',
    'nuxt',
    'perl',
    'springboot',
    'swift',
  ];

  const frameworkToken = frameworkTokens.find((token) => skillNameLower.includes(token));
  if (frameworkToken && !promptLower.includes(frameworkToken)) {
    return 0;
  }

  let score = 0;

  if (promptLower.includes(skillNameLower)) {
    score += 8;
  }

  for (const token of skillNameLower.split(/[-_\s]+/g)) {
    if (tokenMatches(promptTokens, token)) {
      score += 4;
    }
  }

  const keywords = skillRule.promptTriggers?.keywords || [];
  for (const keyword of keywords) {
    if (tokenMatches(promptTokens, keyword)) {
      score += 1;
    }
  }

  if (/\bsecure|security|auth|authentication|authorization\b/i.test(prompt) && /security|auth/.test(skillNameLower)) {
    score += 5;
  }

  if (/\btest|tests|testing|pytest|unit\b/i.test(prompt) && /test|tdd|regression/.test(skillNameLower)) {
    score += 5;
  }

  return score;
}

function selectCandidateSkills(
  prompt: string,
  availableSkills: Record<string, SkillRule>,
  maxCandidates = 32
): Record<string, SkillRule> {
  const promptTokens = getPromptTokens(prompt);
  const scored = Object.entries(availableSkills)
    .map(([skillName, skillRule]) => ({
      skillName,
      skillRule,
      score: scoreCandidateSkill(prompt, promptTokens, skillName, skillRule),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.skillName.localeCompare(b.skillName))
    .slice(0, maxCandidates);

  return Object.fromEntries(scored.map(({ skillName, skillRule }) => [skillName, skillRule]));
}

function commandRuleAsSkillRule(commandName: string, commandRule: CommandRule): SkillRule {
  return {
    type: commandRule.type || 'domain',
    description: commandRule.description,
    autoInject: commandRule.autoInject,
    requiredSkills: commandRule.requiredCommands,
    injectionOrder: commandRule.injectionOrder,
    promptTriggers: commandRule.promptTriggers,
  };
}

function selectCandidateCommands(
  prompt: string,
  availableCommands: Record<string, CommandRule>,
  maxCandidates = 32
): Record<string, CommandRule> {
  const promptTokens = getPromptTokens(prompt);
  const scored = Object.entries(availableCommands)
    .map(([commandName, commandRule]) => ({
      commandName,
      commandRule,
      score: scoreCandidateSkill(
        prompt,
        promptTokens,
        commandName,
        commandRuleAsSkillRule(commandName, commandRule)
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.commandName.localeCompare(b.commandName))
    .slice(0, maxCandidates);

  return Object.fromEntries(
    scored.map(({ commandName, commandRule }) => [commandName, commandRule])
  );
}

function buildCommandMetadataFingerprint(commands: Record<string, CommandRule>): string {
  const metadata = Object.entries(commands)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rule]) => ({
      name,
      description: rule.description || '',
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
      commandRuleAsSkillRule(commandName, commandRule),
    ])
  );
  const matched = matchSkillsByKeywords(prompt, commandRules);

  return {
    requiredCommands: matched.required,
    suggestedCommands: matched.suggested,
    commandScores: {},
  };
}

function matchesCommandTopic(commandName: string, commandRule: CommandRule, topicPattern: RegExp): boolean {
  const searchable = `${commandName} ${commandRule.description || ''}`;
  return topicPattern.test(searchable);
}

/**
 * Analyzes user intent using AI to determine relevant skills
 *
 * Uses AI provider for intent analysis (configurable via OPENCODE_SKILLS_PROVIDER, default: anthropic)
 * to analyze the user's prompt and assign confidence scores to each skill. Falls back to keyword matching for short prompts
 * (5 words or fewer by default) or if AI analysis fails. Results are cached for 1 hour.
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
    };
  }

  const candidateSkills = selectCandidateSkills(prompt, availableSkills);
  const candidateSkillNames = new Set(Object.keys(candidateSkills));
  const candidateCommands = selectCandidateCommands(prompt, availableCommands);
  const candidateCommandNames = new Set(Object.keys(candidateCommands));

  if (candidateSkillNames.size === 0 && candidateCommandNames.size === 0) {
    return { required: [], suggested: [] };
  }

  // Check cache first - include candidate skills/commands hash to invalidate when definitions change
  const skillsHash = createHash('md5')
    .update(JSON.stringify(candidateSkills))
    .digest('hex')
    .substring(0, 8);
  const commandsHash = createHash('md5')
    .update(buildCommandMetadataFingerprint(candidateCommands))
    .digest('hex')
    .substring(0, 8);
  const cacheKey = createHash('md5')
    .update(`candidate-v4:${prompt}:${skillsHash}:${commandsHash}`)
    .digest('hex');

  const cached = readCache(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // Call AI provider
  try {
    const analysis = await callAIForIntentAnalysis(prompt, candidateSkills, candidateCommands);

    // Debug logging
    if (DEBUG_ENABLED) {
      formatDebugOutput(analysis);
    }

    // Categorize by confidence thresholds
    const categorized = categorizeSkills(analysis);
    const categorizedCommands = categorizeCommands(analysis);
    categorized.required = categorized.required.filter((skillName) => candidateSkillNames.has(skillName));
    categorized.suggested = categorized.suggested.filter((skillName) => candidateSkillNames.has(skillName));
    categorizedCommands.required = categorizedCommands.required.filter((commandName) =>
      candidateCommandNames.has(commandName)
    );
    categorizedCommands.suggested = categorizedCommands.suggested.filter((commandName) =>
      candidateCommandNames.has(commandName)
    );

    if (/\bapi\b|\bendpoint\b/i.test(prompt) && candidateSkillNames.has('api-design')) {
      categorized.required.push('api-design');
    }

    if (/\bsecure|security|auth|authentication|authorization\b/i.test(prompt) && candidateSkillNames.has('security-review')) {
      categorized.required.push('security-review');
    }

    if (/\bapi\b|\bendpoint\b/i.test(prompt)) {
      for (const [commandName, commandRule] of Object.entries(candidateCommands)) {
        if (matchesCommandTopic(commandName, commandRule, /\bapi\b|\bendpoint\b/i)) {
          categorizedCommands.required.push(commandName);
        }
      }
    }

    if (/\bsecure|security|auth|authentication|authorization\b/i.test(prompt)) {
      for (const [commandName, commandRule] of Object.entries(candidateCommands)) {
        if (matchesCommandTopic(commandName, commandRule, /\bsecure|security|auth|authentication|authorization\b/i)) {
          categorizedCommands.required.push(commandName);
        }
      }
    }

    categorized.required = Array.from(new Set(categorized.required));
    categorized.suggested = Array.from(
      new Set(categorized.suggested.filter((skillName) => !categorized.required.includes(skillName)))
    );
    categorizedCommands.required = Array.from(new Set(categorizedCommands.required));
    categorizedCommands.suggested = Array.from(
      new Set(
        categorizedCommands.suggested.filter(
          (commandName) => !categorizedCommands.required.includes(commandName)
        )
      )
    );

    // Build result with optional debug scores
    const result = buildAnalysisResult(
      categorized,
      analysis,
      DEBUG_ENABLED
    );
    result.requiredCommands = Array.from(new Set(categorizedCommands.required));
    result.suggestedCommands = Array.from(
      new Set(
        categorizedCommands.suggested.filter(
          (commandName) => !result.requiredCommands!.includes(commandName)
        )
      )
    );
    result.commandScores = {};
    for (const command of analysis.commands || []) {
      if (candidateCommandNames.has(command.name)) {
        result.commandScores[command.name] = command.confidence;
      }
    }

    // Guarantee guardrail skills are included even on long prompts where AI
    // might under-score them. Keyword matcher only returns guardrail skills
    // (autoInject !== false), so this union is safe.
    const keywordHits = matchSkillsByKeywords(prompt, availableSkills);
    for (const skill of keywordHits.required) {
      if (!result.required.includes(skill) && !result.suggested.includes(skill)) {
        result.required.push(skill);
      }
    }

    writeCache(cacheKey, {
      required: result.required,
      suggested: result.suggested,
      requiredCommands: result.requiredCommands,
      suggestedCommands: result.suggestedCommands,
      commandScores: result.commandScores,
    });
    return result;
  } catch (error) {
    debugLog(
      `intent-analyzer: AI analysis failed, using fallback. reason=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.warn('Intent analysis failed, falling back to keyword matching:', error);
    const skillFallback = matchSkillsByKeywords(prompt, availableSkills);
    return {
      ...skillFallback,
      ...buildCommandFallback(prompt, availableCommands),
    };
  }
}

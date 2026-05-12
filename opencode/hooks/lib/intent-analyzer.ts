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
import { categorizeSkills, formatDebugOutput, buildAnalysisResult } from './intent-scorer.js';
import type { AnalysisResult, SkillRule } from './types.js';

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

/**
 * Analyzes user intent using AI to determine relevant skills
 *
 * Uses AI provider for intent analysis (configurable via OPENCODE_SKILLS_PROVIDER, default: anthropic)
 * to analyze the user's prompt and assign confidence scores to each skill. Falls back to keyword matching for short prompts
 * (<10 words) or if AI analysis fails. Results are cached for 1 hour.
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
  availableSkills: Record<string, SkillRule>
): Promise<AnalysisResult> {
  // Skip AI analysis for short prompts (saves API calls)
  const wordCount = prompt.trim().split(/\s+/).length;
  if (wordCount <= SHORT_PROMPT_WORD_THRESHOLD) {
    return matchSkillsByKeywords(prompt, availableSkills);
  }

  const candidateSkills = selectCandidateSkills(prompt, availableSkills);
  const candidateSkillNames = new Set(Object.keys(candidateSkills));

  if (candidateSkillNames.size === 0) {
    return { required: [], suggested: [] };
  }

  // Check cache first - include candidate skills hash to invalidate when definitions change
  const skillsHash = createHash('md5')
    .update(JSON.stringify(candidateSkills))
    .digest('hex')
    .substring(0, 8);
  const cacheKey = createHash('md5')
    .update(`candidate-v2:${prompt}:${skillsHash}`)
    .digest('hex');

  const cached = readCache(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // Call AI provider
  try {
    const analysis = await callAIForIntentAnalysis(prompt, candidateSkills);

    // Debug logging
    if (DEBUG_ENABLED) {
      formatDebugOutput(analysis);
    }

    // Categorize by confidence thresholds
    const categorized = categorizeSkills(analysis);
    categorized.required = categorized.required.filter((skillName) => candidateSkillNames.has(skillName));
    categorized.suggested = categorized.suggested.filter((skillName) => candidateSkillNames.has(skillName));

    if (/\bapi\b|\bendpoint\b/i.test(prompt) && candidateSkillNames.has('api-design')) {
      categorized.required.push('api-design');
    }

    if (/\bsecure|security|auth|authentication|authorization\b/i.test(prompt) && candidateSkillNames.has('security-review')) {
      categorized.required.push('security-review');
    }

    categorized.required = Array.from(new Set(categorized.required));
    categorized.suggested = Array.from(
      new Set(categorized.suggested.filter((skillName) => !categorized.required.includes(skillName)))
    );

    // Build result with optional debug scores
    const result = buildAnalysisResult(
      categorized,
      analysis,
      DEBUG_ENABLED
    );

    // Guarantee guardrail skills are included even on long prompts where AI
    // might under-score them. Keyword matcher only returns guardrail skills
    // (autoInject !== false), so this union is safe.
    const keywordHits = matchSkillsByKeywords(prompt, availableSkills);
    for (const skill of keywordHits.required) {
      if (!result.required.includes(skill) && !result.suggested.includes(skill)) {
        result.required.push(skill);
      }
    }

    writeCache(cacheKey, { required: result.required, suggested: result.suggested });
    return result;
  } catch (error) {
    console.warn('Intent analysis failed, falling back to keyword matching:', error);
    return matchSkillsByKeywords(prompt, availableSkills);
  }
}

#!/usr/bin/env node
/**
 * Intent analysis orchestrator
 *
 * Coordinates AI-powered intent analysis using modular components:
 * - Anthropic API client for skill scoring
 * - Cache manager for result persistence
 * - Keyword matcher for fallback
 * - Intent scorer for categorization
 */

import { createHash } from 'crypto';
import { SHORT_PROMPT_WORD_THRESHOLD } from './constants.js';
import { readCache, writeCache } from './cache-manager.js';
import { callAnthropicAPI } from './anthropic-client.js';
import { matchSkillsByKeywords } from './keyword-matcher.js';
import { categorizeSkills, formatDebugOutput, buildAnalysisResult } from './intent-scorer.js';
import type { AnalysisResult, SkillRule } from './types.js';

// Re-export types for backward compatibility
export type { SkillConfidence, IntentAnalysis, AnalysisResult } from './types.js';

/**
 * Analyzes user intent using AI to determine relevant skills
 *
 * Uses Claude Haiku 4.5 to analyze the user's prompt and assign confidence
 * scores to each skill. Falls back to keyword matching for short prompts
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

  // Check cache first - include skills hash to invalidate when definitions change
  const skillsHash = createHash('md5')
    .update(JSON.stringify(availableSkills))
    .digest('hex')
    .substring(0, 8);
  const cacheKey = createHash('md5')
    .update(prompt + skillsHash)
    .digest('hex');

  const cached = readCache(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // Call Anthropic API
  try {
    const analysis = await callAnthropicAPI(prompt, availableSkills);

    // Debug logging
    if (process.env.CLAUDE_SKILL_DEBUG === 'true') {
      formatDebugOutput(analysis);
    }

    // Categorize by confidence thresholds
    const categorized = categorizeSkills(analysis);

    // Build result with optional debug scores
    const result = buildAnalysisResult(
      categorized,
      analysis,
      process.env.CLAUDE_SKILL_DEBUG === 'true'
    );

    writeCache(cacheKey, { required: result.required, suggested: result.suggested });
    return result;
  } catch (error) {
    console.warn('Intent analysis failed, falling back to keyword matching:', error);
    return matchSkillsByKeywords(prompt, availableSkills);
  }
}

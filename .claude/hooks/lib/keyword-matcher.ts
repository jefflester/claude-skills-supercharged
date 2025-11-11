/**
 * Keyword-based skill detection fallback
 *
 * Provides simple keyword matching when AI intent analysis is unavailable
 * (short prompts, API errors, no API key). Checks configured keywords
 * against the user prompt.
 */

import type { SkillRule } from './types.js';

/**
 * Detect skills using keyword matching
 *
 * Used as fallback when AI analysis is unavailable. Checks if any skill's
 * configured keywords appear in the prompt (case-insensitive).
 *
 * @param prompt - The user's input prompt
 * @param skills - Available skills configuration
 * @returns Detected skills (all marked as required, none as suggested)
 *
 * @example
 * ```typescript
 * const prompt = "Fix the authentication service";
 * const skills = {
 *   'service-layer-development': {
 *     promptTriggers: { keywords: ['service', 'authentication'] }
 *   }
 * };
 * const result = matchSkillsByKeywords(prompt, skills);
 * // Returns: { required: ['service-layer-development'], suggested: [] }
 * ```
 */
export function matchSkillsByKeywords(
  prompt: string,
  skills: Record<string, SkillRule>
): { required: string[]; suggested: string[] } {
  const promptLower = prompt.toLowerCase();
  const detected: string[] = [];

  for (const [name, config] of Object.entries(skills)) {
    const keywords = config.promptTriggers?.keywords || [];
    if (keywords.some((kw: string) => promptLower.includes(kw.toLowerCase()))) {
      detected.push(name);
    }
  }

  return { required: detected, suggested: [] };
}

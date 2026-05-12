/**
 * Keyword-based skill detection fallback
 *
 * Provides simple keyword matching when AI intent analysis is unavailable
 * (short prompts, API errors, no API key). Checks configured keywords
 * against the user prompt.
 */

import type { SkillRule } from './types.js';
import { FALLBACK_DOMAIN_MODE } from './constants.js';

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

function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

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
  const required: string[] = [];
  const suggested: string[] = [];

  for (const [name, config] of Object.entries(skills)) {
    const keywords = config.promptTriggers?.keywords || [];
    const matched = keywords.some((kw: string) => {
      const normalizedKeyword = normalizeKeyword(kw);
      return (
        normalizedKeyword.length >= 3 &&
        !COMMON_TRIGGER_STOPWORDS.has(normalizedKeyword) &&
        promptLower.includes(kw.toLowerCase())
      );
    });
    if (!matched) continue;

    if (config.autoInject === true) {
      // Guardrail skills: always required when matched
      required.push(name);
    } else {
      // Domain skills: behavior depends on FALLBACK_DOMAIN_MODE
      switch (FALLBACK_DOMAIN_MODE) {
        case 'off':
          // Skip domain skills entirely
          break;
        case 'inject':
          required.push(name);
          break;
        case 'suggest':
        default:
          suggested.push(name);
          break;
      }
    }
  }

  return { required, suggested };
}

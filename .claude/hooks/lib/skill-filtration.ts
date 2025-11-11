/**
 * Skill filtering, promotion, and affinity injection logic
 *
 * Handles filtering of acknowledged skills, promotion of suggested skills to
 * fill the 2-skill target, and bidirectional affinity-based auto-injection.
 */

import type { SkillRule } from './types.js';

/**
 * Result of skill filtration and promotion
 */
export interface FiltrationResult {
  toInject: string[];
  promoted: string[];
  remainingSuggested: string[];
}

/**
 * Filter out already acknowledged skills and those with autoInject: false
 *
 * @param skills - Skills to filter
 * @param acknowledged - Previously acknowledged skills
 * @param skillRules - Skill configuration
 * @returns Filtered list of unacknowledged skills
 */
export function filterUnacknowledgedSkills(
  skills: string[],
  acknowledged: string[],
  skillRules: Record<string, SkillRule>
): string[] {
  return skills.filter(
    (skill) => !acknowledged.includes(skill) && skillRules[skill]?.autoInject !== false
  );
}

/**
 * Apply skill injection limits with promotion logic
 *
 * Promotes suggested skills to fill the 2-skill target. Target calculation
 * accounts for critical skills already loaded in the session.
 *
 * @param criticalSkills - Unacknowledged required skills (confidence > 0.65)
 * @param recommendedSkills - Unacknowledged suggested skills (confidence 0.50-0.65)
 * @param acknowledgedCriticalCount - Count of critical skills already loaded
 * @returns Object with skills to inject, promoted skills, and remaining suggested
 */
export function applyInjectionLimits(
  criticalSkills: string[],
  recommendedSkills: string[],
  acknowledgedCriticalCount: number
): FiltrationResult {
  const TARGET_SLOTS = 2; // Standard 2-skill injection limit

  // Calculate promotion target: 2 total - already loaded critical skills
  const promotionTarget = Math.max(0, TARGET_SLOTS - acknowledgedCriticalCount);

  // Start with critical skills (up to promotion target)
  const toInject = [...criticalSkills.slice(0, promotionTarget)];

  // Calculate how many more skills we need to reach target
  const needed = Math.max(0, promotionTarget - toInject.length);

  // Promote recommended skills to fill empty slots
  const promotedRecommended: string[] = [];
  if (needed > 0 && recommendedSkills.length > 0) {
    const promoted = recommendedSkills.slice(0, needed);
    promotedRecommended.push(...promoted);
    toInject.push(...promoted);
  }

  // Remaining recommended skills (not promoted)
  const remainingSuggested = recommendedSkills.filter((s) => !promotedRecommended.includes(s));

  return {
    toInject,
    promoted: promotedRecommended,
    remainingSuggested,
  };
}

/**
 * Find skills to auto-inject based on bidirectional affinity
 *
 * Checks both directions:
 * - If injecting skill A with affinity [B, C], inject B and C (parent → child)
 * - If any skill lists A in its affinity, inject that skill (child → parent)
 *
 * Respects acknowledged skills (don't re-inject).
 * Free of slot cost (affinity skills don't count toward 2-skill limit).
 *
 * @param toInject - Skills being injected
 * @param acknowledged - Already loaded skills
 * @param skillRules - Skill configuration
 * @returns Additional skills to inject due to affinity (free of slot cost)
 *
 * @example
 * ```typescript
 * // Injecting frontend-framework (has affinity: ["system-architecture", "api-protocols"])
 * const affinities = findAffinityInjections(
 *   ["frontend-framework"],
 *   [],
 *   skillRules
 * );
 * // Returns: ["system-architecture", "api-protocols"]
 *
 * // If architecture already loaded
 * const affinities = findAffinityInjections(
 *   ["frontend-framework"],
 *   ["system-architecture"],
 *   skillRules
 * );
 * // Returns: ["api-protocols"] (only unloaded affinity)
 * ```
 */
export function findAffinityInjections(
  toInject: string[],
  acknowledged: string[],
  skillRules: Record<string, SkillRule>
): string[] {
  const affinitySet = new Set<string>();

  for (const skill of toInject) {
    const config = skillRules[skill];

    // Direction 1: This skill lists affinities (parent → child)
    // Example: frontend-framework → ["system-architecture", "api-protocols"]
    const affinities = config?.affinity || [];
    for (const affinity of affinities) {
      // Only inject if:
      // 1. Not already acknowledged (loaded in session)
      // 2. Not already in toInject list
      // 3. autoInject is not false
      if (
        !acknowledged.includes(affinity) &&
        !toInject.includes(affinity) &&
        skillRules[affinity]?.autoInject !== false
      ) {
        affinitySet.add(affinity);
      }
    }

    // Direction 2: Other skills list this skill in their affinity (child → parent)
    // Example: system-architecture not in toInject, but frontend-framework (which is in toInject)
    //          is listed in other skills' affinities
    for (const [otherSkill, otherConfig] of Object.entries(skillRules)) {
      const otherAffinities = otherConfig.affinity || [];
      if (otherAffinities.includes(skill)) {
        // Only inject if:
        // 1. Not already acknowledged
        // 2. Not already in toInject
        // 3. autoInject is not false
        if (
          !acknowledged.includes(otherSkill) &&
          !toInject.includes(otherSkill) &&
          otherConfig.autoInject !== false
        ) {
          affinitySet.add(otherSkill);
        }
      }
    }
  }

  return Array.from(affinitySet);
}

/**
 * Complete filtration workflow: filter + promotion + affinity
 *
 * Combines all filtration steps:
 * 1. Filter out acknowledged skills
 * 2. Calculate promotion target (2 - acknowledged critical count)
 * 3. Apply promotion to reach target
 *
 * Note: Affinity injection happens separately in the main hook flow
 * after this function returns, to maintain clear separation of concerns.
 *
 * @param requiredSkills - Critical skills from AI analysis
 * @param suggestedSkills - Recommended skills from AI analysis
 * @param acknowledged - Previously acknowledged skills
 * @param skillRules - Skill configuration
 * @returns Filtration result with skills to inject and metadata
 */
export function filterAndPromoteSkills(
  requiredSkills: string[],
  suggestedSkills: string[],
  acknowledged: string[],
  skillRules: Record<string, SkillRule>
): FiltrationResult {
  // Filter out acknowledged skills
  const unacknowledgedCritical = filterUnacknowledgedSkills(
    requiredSkills,
    acknowledged,
    skillRules
  );
  const unacknowledgedRecommended = filterUnacknowledgedSkills(
    suggestedSkills,
    acknowledged,
    skillRules
  );

  // Calculate how many critical skills are already loaded
  const acknowledgedCriticalCount = requiredSkills.filter((s) => acknowledged.includes(s)).length;

  // Apply promotion to reach 2-skill target
  return applyInjectionLimits(
    unacknowledgedCritical,
    unacknowledgedRecommended,
    acknowledgedCriticalCount
  );
}

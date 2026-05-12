/**
 * Skill filtering, promotion, and affinity injection logic
 *
 * Handles filtering of acknowledged skills, promotion of suggested skills to
 * fill the 2-skill target, and bidirectional affinity-based auto-injection.
 */

import type { SkillRule } from './types.js';
import { MAX_REQUIRED_SKILLS } from './constants.js';

/**
 * Result of skill filtration and promotion
 */
export interface FiltrationResult {
  toInject: string[];
  promoted: string[];
  remainingSuggested: string[];
}

/**
 * Filter out already acknowledged skills
 *
 * @param skills - Skills to filter
 * @param acknowledged - Previously acknowledged skills
 * @returns Filtered list of unacknowledged skills
 */
export function filterUnacknowledgedSkills(
  skills: string[],
  acknowledged: string[]
): string[] {
  return skills.filter((skill) => !acknowledged.includes(skill));
}

/**
 * Apply skill injection limits with promotion logic
 *
 * Guardrail skills are always included (exempt from cap). The required-skill cap
 * applies only to domain skills. Promotes suggested domain skills to fill
 * the target. Target calculation accounts for domain skills already loaded.
 *
 * @param criticalSkills - Unacknowledged required skills (confidence > 0.65)
 * @param recommendedSkills - Unacknowledged suggested skills (confidence 0.50-0.65)
 * @param acknowledgedCriticalCount - Count of critical skills already loaded
 * @param skillRules - Skill configuration (used to identify guardrails)
 * @returns Object with skills to inject, promoted skills, and remaining suggested
 */
export function applyInjectionLimits(
  criticalSkills: string[],
  recommendedSkills: string[],
  acknowledgedCriticalCount: number,
  skillRules: Record<string, SkillRule>
): FiltrationResult {
  const TARGET_SLOTS = MAX_REQUIRED_SKILLS; // Domain-skill injection limit

  // Separate guardrail skills from domain skills — guardrails are exempt from cap
  const criticalGuardrails = criticalSkills.filter((s) => skillRules[s]?.type === 'guardrail');
  const criticalDomain = criticalSkills.filter((s) => skillRules[s]?.type !== 'guardrail');
  const recommendedDomain = recommendedSkills.filter((s) => skillRules[s]?.type !== 'guardrail');
  const recommendedGuardrails = recommendedSkills.filter((s) => skillRules[s]?.type === 'guardrail');

  // Calculate promotion target for domain skills: 2 total - already loaded domain critical
  const promotionTarget = Math.max(0, TARGET_SLOTS - acknowledgedCriticalCount);

  // Start with critical domain skills (up to promotion target)
  const domainToInject = [...criticalDomain.slice(0, promotionTarget)];

  // Calculate how many more domain skills we need to reach target
  const needed = Math.max(0, promotionTarget - domainToInject.length);

  // Promote recommended domain skills to fill empty slots
  const promotedRecommended: string[] = [];
  if (needed > 0 && recommendedDomain.length > 0) {
    const promoted = recommendedDomain.slice(0, needed);
    promotedRecommended.push(...promoted);
    domainToInject.push(...promoted);
  }

  // Always include all guardrails (exempt from cap)
  const toInject = [...criticalGuardrails, ...recommendedGuardrails, ...domainToInject];

  // Remaining recommended skills (not promoted, excluding guardrails already included)
  const remainingSuggested = recommendedDomain.filter((s) => !promotedRecommended.includes(s));

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
    // Enforce max 2 items at runtime (matches schema constraint)
    const affinities = (config?.affinity || []).slice(0, 2);
    for (const affinity of affinities) {
      // Only inject if not already acknowledged or in toInject list
      if (!acknowledged.includes(affinity) && !toInject.includes(affinity)) {
        affinitySet.add(affinity);
      }
    }

    // Direction 2: Other skills list this skill in their affinity (child → parent)
    // Example: system-architecture not in toInject, but frontend-framework (which is in toInject)
    //          is listed in other skills' affinities
    for (const [otherSkill, otherConfig] of Object.entries(skillRules)) {
      const otherAffinities = otherConfig.affinity || [];
      if (otherAffinities.includes(skill)) {
        // Only inject if not already acknowledged or in toInject
        if (!acknowledged.includes(otherSkill) && !toInject.includes(otherSkill)) {
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
 * 2. Calculate promotion target (required cap - acknowledged critical count)
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
  const unacknowledgedCritical = filterUnacknowledgedSkills(requiredSkills, acknowledged);
  const unacknowledgedRecommended = filterUnacknowledgedSkills(suggestedSkills, acknowledged);

  // Calculate how many critical domain skills are already loaded (guardrails
  // are exempt from the cap, so they shouldn't reduce domain slots)
  const acknowledgedCriticalCount = requiredSkills.filter(
    (s) => acknowledged.includes(s) && skillRules[s]?.type !== 'guardrail'
  ).length;

  // Apply promotion to reach required-skill target (guardrails exempt from cap)
  return applyInjectionLimits(
    unacknowledgedCritical,
    unacknowledgedRecommended,
    acknowledgedCriticalCount,
    skillRules
  );
}

/**
 * Skill dependency resolution with cycle detection
 *
 * Resolves skill dependencies recursively using depth-first search,
 * detects circular dependencies, and sorts by injection order.
 */

import type { SkillRule } from './types.js';

/**
 * Resolve skill dependencies recursively with cycle detection
 *
 * Performs a depth-first traversal of skill dependencies, building a complete
 * set of skills to inject including all transitive dependencies. Detects
 * circular dependencies and sorts final result by injection order.
 *
 * @param skills - Initial set of skills to resolve
 * @param skillRules - Skill configuration from skill-rules.json
 * @returns Sorted array of skill names (dependencies first, then ordered by injectionOrder)
 *
 * @example
 * ```typescript
 * const skills = ['service-layer-development'];
 * const resolved = resolveSkillDependencies(skills, skillRules);
 * // Returns: ['api-protocols', 'service-layer-development']
 * ```
 */
export function resolveSkillDependencies(
  skills: string[],
  skillRules: Record<string, SkillRule>
): string[] {
  const resolved = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection
  const errors: string[] = []; // Collect all errors

  function visit(skillName: string, path: string[] = []): void {
    // Cycle detection
    if (visiting.has(skillName)) {
      errors.push(`Circular dependency: ${[...path, skillName].join(' → ')}`);
      return;
    }

    // Already resolved
    if (resolved.has(skillName)) return;

    const skill = skillRules[skillName];
    if (!skill) {
      errors.push(`Skill not found: ${skillName}`);
      return;
    }

    // Mark as visiting
    visiting.add(skillName);
    path.push(skillName);

    // Visit dependencies first (DFS)
    const deps = skill.requiredSkills || [];
    deps.forEach((dep) => visit(dep, [...path]));

    // Add to resolved
    resolved.add(skillName);
    visiting.delete(skillName);
  }

  // Visit each root skill
  skills.forEach((skill) => visit(skill));

  // Report all errors together
  if (errors.length > 0) {
    console.error('⚠️ Skill dependency resolution errors:');
    errors.forEach((err) => console.error(`  - ${err}`));
  }

  // Sort by injection order
  return Array.from(resolved).sort((a, b) => {
    const orderA = skillRules[a]?.injectionOrder || 50;
    const orderB = skillRules[b]?.injectionOrder || 50;
    return orderA - orderB;
  });
}

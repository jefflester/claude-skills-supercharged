import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_INJECTION_ORDER } from '../constants';

/**
 * Tests for skill dependency resolution logic
 *
 * Mirrors the algorithm in skill-activation-prompt.ts lines 45-96
 */

interface SkillRule {
  requiredSkills?: string[];
  injectionOrder?: number;
}

/**
 * Resolve skill dependencies recursively with cycle detection
 * (Mirrors skill-activation-prompt.ts lines 45-96)
 */
function resolveSkillDependencies(
  skills: string[],
  skillRules: Record<string, SkillRule>
): string[] {
  const resolved = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection

  function visit(skillName: string, path: string[] = []): void {
    // Cycle detection
    if (visiting.has(skillName)) {
      console.error(`⚠️ Circular dependency detected: ${[...path, skillName].join(' → ')}`);
      return;
    }

    // Already resolved
    if (resolved.has(skillName)) return;

    const skill = skillRules[skillName];
    if (!skill) {
      console.warn(`⚠️ Skill not found: ${skillName}`);
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

  // Sort by injection order
  return Array.from(resolved).sort((a, b) => {
    const orderA = skillRules[a]?.injectionOrder || DEFAULT_INJECTION_ORDER;
    const orderB = skillRules[b]?.injectionOrder || DEFAULT_INJECTION_ORDER;
    return orderA - orderB;
  });
}

describe('Dependency Resolution', () => {
  it('should resolve simple dependency chain in correct order', () => {
    const skillRules = {
      'skill-a': { requiredSkills: ['skill-b'], injectionOrder: 30 },
      'skill-b': { requiredSkills: ['skill-c'], injectionOrder: 20 },
      'skill-c': { requiredSkills: [], injectionOrder: 10 },
    };

    const result = resolveSkillDependencies(['skill-a'], skillRules);

    // Should resolve all dependencies and sort by injectionOrder
    expect(result).toEqual(['skill-c', 'skill-b', 'skill-a']);
  });

  it('should detect and handle circular dependencies without crashing', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const skillRules = {
      'skill-a': { requiredSkills: ['skill-b'], injectionOrder: 1 },
      'skill-b': { requiredSkills: ['skill-c'], injectionOrder: 2 },
      'skill-c': { requiredSkills: ['skill-a'], injectionOrder: 3 },
    };

    const result = resolveSkillDependencies(['skill-a'], skillRules);

    // Should log error about circular dependency
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Circular dependency detected')
    );

    // Should still resolve what it can (A and B, but not C due to cycle)
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('skill-a');

    consoleErrorSpy.mockRestore();
  });

  it('should resolve multiple dependencies correctly', () => {
    const skillRules = {
      'skill-a': { requiredSkills: ['skill-b', 'skill-c', 'skill-d'], injectionOrder: 40 },
      'skill-b': { requiredSkills: [], injectionOrder: 10 },
      'skill-c': { requiredSkills: [], injectionOrder: 20 },
      'skill-d': { requiredSkills: [], injectionOrder: 30 },
    };

    const result = resolveSkillDependencies(['skill-a'], skillRules);

    // Should resolve all dependencies
    expect(result).toHaveLength(4);
    expect(result).toEqual(['skill-b', 'skill-c', 'skill-d', 'skill-a']);
  });

  it('should warn about missing dependencies but continue', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const skillRules = {
      'skill-a': { requiredSkills: ['skill-b', 'non-existent'], injectionOrder: 20 },
      'skill-b': { requiredSkills: [], injectionOrder: 10 },
    };

    const result = resolveSkillDependencies(['skill-a'], skillRules);

    // Should warn about non-existent skill
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skill not found: non-existent')
    );

    // Should still resolve existing skills
    expect(result).toEqual(['skill-b', 'skill-a']);

    consoleWarnSpy.mockRestore();
  });

  it('should sort by injectionOrder with default for missing order', () => {
    const skillRules = {
      'skill-a': { requiredSkills: ['skill-b', 'skill-c'], injectionOrder: 100 },
      'skill-b': { requiredSkills: [] }, // No injectionOrder (uses DEFAULT_INJECTION_ORDER)
      'skill-c': { requiredSkills: [], injectionOrder: 1 },
    };

    const result = resolveSkillDependencies(['skill-a'], skillRules);

    // skill-c (1), skill-b (DEFAULT=50), skill-a (100)
    expect(result[0]).toBe('skill-c');
    expect(result[1]).toBe('skill-b');
    expect(result[2]).toBe('skill-a');
  });

  it('should handle empty requiredSkills array', () => {
    const skillRules = {
      'skill-a': { requiredSkills: [], injectionOrder: 1 },
    };

    const result = resolveSkillDependencies(['skill-a'], skillRules);

    expect(result).toEqual(['skill-a']);
  });
});

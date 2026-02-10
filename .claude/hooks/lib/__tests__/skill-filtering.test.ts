import { describe, it, expect } from 'vitest';
import {
  filterUnacknowledgedSkills,
  applyInjectionLimits,
  filterAndPromoteSkills,
} from '../skill-filtration.js';
import type { SkillRule } from '../types.js';

/**
 * Tests for skill filtering and promotion logic
 *
 * Validates filtering of acknowledged skills, promotion to fill 2-skill target,
 * and integration with the acknowledgment system.
 */

describe('Skill Filtering', () => {
  describe('filterUnacknowledgedSkills', () => {
    it('should filter out already acknowledged skills', () => {
      const skills = ['python-best-practices', 'git-workflow', 'api-security'];
      const acknowledged = ['python-best-practices', 'git-workflow'];

      const unacknowledged = filterUnacknowledgedSkills(skills, acknowledged);

      expect(unacknowledged).toEqual(['api-security']);
    });

    it('should return all skills when none acknowledged', () => {
      const skills = ['python-best-practices', 'skill-developer', 'api-security'];
      const acknowledged: string[] = [];

      const unacknowledged = filterUnacknowledgedSkills(skills, acknowledged);

      expect(unacknowledged).toEqual(['python-best-practices', 'skill-developer', 'api-security']);
    });
  });

  describe('applyInjectionLimits', () => {
    // All domain skills for basic limit tests
    const domainRules: Record<string, SkillRule> = {
      'skill-a': { type: 'domain' },
      'skill-b': { type: 'domain' },
      'skill-c': { type: 'domain' },
      'skill-d': { type: 'domain' },
      'skill-e': { type: 'domain' },
    };

    it('should inject up to 2 domain skills when acknowledgedCriticalCount = 0', () => {
      const critical = ['skill-a', 'skill-b', 'skill-c'];
      const recommended: string[] = [];
      const acknowledgedCriticalCount = 0;

      const { toInject } = applyInjectionLimits(
        critical,
        recommended,
        acknowledgedCriticalCount,
        domainRules
      );

      expect(toInject).toHaveLength(2);
      expect(toInject).toEqual(['skill-a', 'skill-b']);
    });

    it('should promote recommended skills to fill empty slots', () => {
      const critical = ['skill-a'];
      const recommended = ['skill-b', 'skill-c', 'skill-d'];
      const acknowledgedCriticalCount = 0;

      const { toInject, promoted } = applyInjectionLimits(
        critical,
        recommended,
        acknowledgedCriticalCount,
        domainRules
      );

      expect(toInject).toHaveLength(2);
      expect(toInject).toEqual(['skill-a', 'skill-b']);
      expect(promoted).toEqual(['skill-b']);
    });

    it('should promote 2 recommended when no critical skills (target = 2)', () => {
      const critical: string[] = [];
      const recommended = ['skill-a', 'skill-b', 'skill-c'];
      const acknowledgedCriticalCount = 0;

      const { toInject, promoted } = applyInjectionLimits(
        critical,
        recommended,
        acknowledgedCriticalCount,
        domainRules
      );

      expect(toInject).toHaveLength(2);
      expect(toInject).toEqual(['skill-a', 'skill-b']);
      expect(promoted).toEqual(['skill-a', 'skill-b']);
    });

    it('should reduce target when critical skills already acknowledged', () => {
      const critical = ['skill-a'];
      const recommended = ['skill-b', 'skill-c'];
      const acknowledgedCriticalCount = 1;

      const { toInject, promoted } = applyInjectionLimits(
        critical,
        recommended,
        acknowledgedCriticalCount,
        domainRules
      );

      expect(toInject).toHaveLength(1);
      expect(toInject).toEqual(['skill-a']);
      expect(promoted).toEqual([]);
    });

    it('should inject 0 domain skills when 2 already acknowledged', () => {
      const critical: string[] = [];
      const recommended = ['skill-a', 'skill-b'];
      const acknowledgedCriticalCount = 2;

      const { toInject, promoted } = applyInjectionLimits(
        critical,
        recommended,
        acknowledgedCriticalCount,
        domainRules
      );

      expect(toInject).toEqual([]);
      expect(promoted).toEqual([]);
    });

    it('should separate promoted from remaining recommended skills', () => {
      const critical = ['skill-a'];
      const recommended = ['skill-b', 'skill-c', 'skill-d', 'skill-e'];
      const acknowledgedCriticalCount = 0;

      const { toInject, promoted, remainingSuggested } = applyInjectionLimits(
        critical,
        recommended,
        acknowledgedCriticalCount,
        domainRules
      );

      expect(toInject).toEqual(['skill-a', 'skill-b']);
      expect(promoted).toEqual(['skill-b']);
      expect(remainingSuggested).toEqual(['skill-c', 'skill-d', 'skill-e']);
    });

    it('should always include guardrail skills exempt from 2-skill cap', () => {
      const mixedRules: Record<string, SkillRule> = {
        'guardrail-a': { type: 'guardrail' },
        'domain-a': { type: 'domain' },
        'domain-b': { type: 'domain' },
        'domain-c': { type: 'domain' },
      };

      const critical = ['guardrail-a', 'domain-a', 'domain-b', 'domain-c'];
      const recommended: string[] = [];
      const acknowledgedCriticalCount = 0;

      const { toInject } = applyInjectionLimits(
        critical,
        recommended,
        acknowledgedCriticalCount,
        mixedRules
      );

      // Guardrail always included + 2 domain skills (cap)
      expect(toInject).toContain('guardrail-a');
      expect(toInject).toContain('domain-a');
      expect(toInject).toContain('domain-b');
      expect(toInject).not.toContain('domain-c');
      expect(toInject).toHaveLength(3);
    });
  });

  describe('filterAndPromoteSkills (Integration)', () => {
    it('should filter + promote when 1 critical already loaded', () => {
      const requiredSkills = ['python-best-practices', 'api-security'];
      const suggestedSkills = ['git-workflow', 'skill-developer'];
      const acknowledged = ['api-security'];
      const skillRules: Record<string, SkillRule> = {
        'python-best-practices': { type: 'domain' },
        'api-security': { type: 'guardrail' },
        'git-workflow': { type: 'domain' },
        'skill-developer': { type: 'domain' },
      };

      const result = filterAndPromoteSkills(
        requiredSkills,
        suggestedSkills,
        acknowledged,
        skillRules
      );

      // Target = 2 - 1 (acknowledged critical) = 1 domain slot
      // python-best-practices fills 1 domain slot
      expect(result.toInject).toEqual(['python-best-practices']);
      expect(result.promoted).toEqual([]);
      expect(result.remainingSuggested).toEqual(['git-workflow', 'skill-developer']);
    });

    it('should promote when all critical skills already loaded', () => {
      const requiredSkills = ['python-best-practices', 'api-security'];
      const suggestedSkills = ['git-workflow', 'skill-developer'];
      const acknowledged = ['python-best-practices', 'api-security'];
      const skillRules: Record<string, SkillRule> = {
        'python-best-practices': { type: 'domain' },
        'api-security': { type: 'guardrail' },
        'git-workflow': { type: 'domain' },
        'skill-developer': { type: 'domain' },
      };

      const result = filterAndPromoteSkills(
        requiredSkills,
        suggestedSkills,
        acknowledged,
        skillRules
      );

      // Target = 2 - 2 (acknowledged) = 0 domain slots
      // No skills to inject
      expect(result.toInject).toEqual([]);
      expect(result.promoted).toEqual([]);
      expect(result.remainingSuggested).toEqual(['git-workflow', 'skill-developer']);
    });

    it('should promote 2 suggested domain skills and always include guardrails', () => {
      const requiredSkills: string[] = [];
      const suggestedSkills = ['python-best-practices', 'api-security', 'git-workflow'];
      const acknowledged: string[] = [];
      const skillRules: Record<string, SkillRule> = {
        'python-best-practices': { type: 'domain' },
        'api-security': { type: 'guardrail' },
        'git-workflow': { type: 'domain' },
      };

      const result = filterAndPromoteSkills(
        requiredSkills,
        suggestedSkills,
        acknowledged,
        skillRules
      );

      // Guardrail (api-security) always included + 2 domain promoted
      expect(result.toInject).toContain('api-security');
      expect(result.toInject).toContain('python-best-practices');
      expect(result.toInject).toContain('git-workflow');
      expect(result.toInject).toHaveLength(3);
      expect(result.promoted).toEqual(['python-best-practices', 'git-workflow']);
      expect(result.remainingSuggested).toEqual([]);
    });

    it('should include all skills when AI scores them (autoInject: false no longer filters)', () => {
      const requiredSkills = ['python-best-practices'];
      const suggestedSkills = ['skill-developer', 'git-workflow'];
      const acknowledged: string[] = [];
      const skillRules: Record<string, SkillRule> = {
        'python-best-practices': { type: 'domain' },
        'skill-developer': {
          type: 'domain',
          autoInject: false,
        },
        'git-workflow': { type: 'domain' },
      };

      const result = filterAndPromoteSkills(
        requiredSkills,
        suggestedSkills,
        acknowledged,
        skillRules
      );

      // autoInject: false no longer blocks AI-scored skills from injection
      // python-best-practices (critical) + skill-developer (promoted) fill 2 slots
      expect(result.toInject).toEqual(['python-best-practices', 'skill-developer']);
      expect(result.promoted).toEqual(['skill-developer']);
      expect(result.remainingSuggested).toEqual(['git-workflow']);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { validateSkillRules } from '../schema-validator';

describe('validateSkillRules', () => {
  it('should accept valid skill rules', () => {
    const validRules = {
      version: '1.0',
      skills: {
        'test-skill': {
          type: 'domain',
          enforcement: 'suggest',
          priority: 'high',
          autoInject: true,
          requiredSkills: [],
        },
      },
    };

    const result = validateSkillRules(validRules);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing version', () => {
    const invalid = {
      skills: {},
    };

    const result = validateSkillRules(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: version');
  });

  it('should reject missing skills object', () => {
    const invalid = {
      version: '1.0',
    };

    const result = validateSkillRules(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('skills'))).toBe(true);
  });

  it('should reject invalid skill type', () => {
    const invalid = {
      version: '1.0',
      skills: {
        'bad-skill': {
          type: 'invalid',
          enforcement: 'suggest',
          priority: 'high',
          autoInject: true,
        },
      },
    };

    const result = validateSkillRules(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('bad-skill'))).toBe(true);
    expect(result.errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('should reject missing autoInject field', () => {
    const invalid = {
      version: '1.0',
      skills: {
        'test-skill': {
          type: 'domain',
          enforcement: 'suggest',
          priority: 'high',
        },
      },
    };

    const result = validateSkillRules(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('autoInject'))).toBe(true);
  });

  it('should validate affinity configuration', () => {
    const withAffinity = {
      version: '1.0',
      skills: {
        'skill-with-affinity': {
          type: 'domain',
          enforcement: 'suggest',
          priority: 'high',
          autoInject: true,
          affinity: ['other-skill'],
        },
      },
    };

    const result = validateSkillRules(withAffinity);
    expect(result.valid).toBe(true);
  });

  it('should reject non-array affinity', () => {
    const invalid = {
      version: '1.0',
      skills: {
        'test-skill': {
          type: 'domain',
          enforcement: 'suggest',
          priority: 'high',
          autoInject: true,
          affinity: 'not-an-array',
        },
      },
    };

    const result = validateSkillRules(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('affinity must be array'))).toBe(true);
  });

  it('should reject affinity with more than 2 skills', () => {
    const invalid = {
      version: '1.0',
      skills: {
        'test-skill': {
          type: 'domain',
          enforcement: 'suggest',
          priority: 'high',
          autoInject: true,
          affinity: ['skill-1', 'skill-2', 'skill-3'],
        },
      },
    };

    const result = validateSkillRules(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('affinity can have max 2 skills'))).toBe(true);
  });
});

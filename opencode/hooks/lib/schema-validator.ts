/**
 * Runtime validation for skill-rules.json structure
 *
 * Provides basic runtime validation to catch configuration errors early.
 * Full schema validation happens in pre-commit hooks via Python + jsonschema.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate skill-rules.json structure at runtime
 *
 * @param skillRules - The parsed skill rules configuration object
 * @returns Validation result with any errors found
 *
 * @example
 * const rules = JSON.parse(readFileSync('skill-rules.json', 'utf-8'));
 * const result = validateSkillRules(rules);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 */
export function validateSkillRules(skillRules: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof skillRules !== 'object' || skillRules === null) {
    errors.push('Skill rules must be a non-null object');
    return { valid: false, errors };
  }

  const rules = skillRules as Record<string, unknown>;

  if (!rules.version) {
    errors.push('Missing required field: version');
  }

  if (!rules.skills || typeof rules.skills !== 'object') {
    errors.push('Missing or invalid field: skills (must be object)');
    return { valid: false, errors };
  }

  for (const [skillName, config] of Object.entries(rules.skills as Record<string, unknown>)) {
    if (typeof config !== 'object' || config === null) {
      errors.push(`${skillName}: Skill config must be a non-null object`);
      continue;
    }

    const skill = config as Record<string, unknown>;

    // Validate required fields
    if (!skill.type || (skill.type !== 'guardrail' && skill.type !== 'domain')) {
      errors.push(`${skillName}: Invalid or missing 'type' (must be 'guardrail' or 'domain')`);
    }

    if (typeof skill.autoInject !== 'boolean') {
      errors.push(`${skillName}: Missing or invalid 'autoInject' (must be boolean)`);
    }

    // Validate affinity if present
    if (skill.affinity !== undefined) {
      if (!Array.isArray(skill.affinity)) {
        errors.push(`${skillName}: affinity must be array`);
      } else if (skill.affinity.length > 2) {
        errors.push(`${skillName}: affinity can have max 2 skills`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

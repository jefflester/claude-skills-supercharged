/**
 * Skill discovery from SKILL.md files in the OpenCode skills directory
 *
 * When no skill-rules.json is present, this module scans the skills directory
 * and builds a runtime SkillRulesConfig from available SKILL.md files by
 * parsing YAML frontmatter and deriving keywords from name/description.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { join } from 'path';
import type { SkillRule, SkillRulesConfig } from './types.js';
import { SKILL_RULES_PATH, SKILLS_DIR } from './constants.js';

/**
 * Parse YAML frontmatter from SKILL.md content
 *
 * Extracts key-value pairs from the --- delimited block at the top of the file.
 * Only handles simple top-level string fields (name, description, origin).
 *
 * @param content - Full file content
 * @returns Record of parsed frontmatter fields or empty object
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return {};
  }

  const endIndex = trimmed.indexOf('\n---', 4);
  if (endIndex < 0) {
    return {};
  }

  const frontmatter = trimmed.slice(3, endIndex);
  const result: Record<string, string> = {};

  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (match) {
      const value = match[2].trim();
      result[match[1]] = value;
    }
  }

  return result;
}

/**
 * Extract a useful description from the body of a SKILL.md file
 *
 * Falls back to the first non-empty heading or paragraph after the frontmatter.
 *
 * @param content - Full file content
 * @returns Extracted description or empty string
 */
export function extractBodyDescription(content: string): string {
  const trimmed = content.trimStart();
  const frontmatterEnd = trimmed.indexOf('\n---', 4);
  const body = frontmatterEnd >= 0 ? trimmed.slice(frontmatterEnd + 4) : trimmed;

  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  for (const line of lines) {
    if (line.startsWith('#')) {
      return line.replace(/^#+\s*/, '').trim();
    }
  }

  for (const line of lines) {
    if (!line.startsWith('```') && !line.startsWith('---')) {
      return line;
    }
  }

  return '';
}

/**
 * Derive conservative keyword triggers from skill name and description
 *
 * Produces an array of lowercase keywords suitable for keyword fallback matching.
 *
 * @param name - Skill name (directory name or frontmatter name)
 * @param description - Skill description
 * @returns Array of derived keywords
 */
export function deriveKeywords(name: string, description: string): string[] {
  const keywords = new Set<string>();

  // Add the full skill name
  keywords.add(name.toLowerCase());

  // Add words from the name
  const nameWords = name.toLowerCase().split(/[-_\s]+/);
  for (const word of nameWords) {
    if (word.length >= 3) {
      keywords.add(word);
    }
  }

  // Add significant words from description (first 50 words, 4+ chars)
  const descWords = description.toLowerCase().split(/\s+/);
  for (const word of descWords.slice(0, 50)) {
    const clean = word.replace(/[^a-z0-9]/g, '');
    if (clean.length >= 4) {
      keywords.add(clean);
    }
  }

  return Array.from(keywords);
}

/**
 * Build a SkillRule from SKILL.md frontmatter and body content
 *
 * @param skillName - Directory name of the skill
 * @param content - Full content of SKILL.md
 * @returns Constructed SkillRule
 */
export function buildSkillRuleFromFile(skillName: string, content: string): SkillRule {
  const frontmatter = parseFrontmatter(content);
  const name = frontmatter.name || skillName;
  const description = frontmatter.description || extractBodyDescription(content);
  const keywords = deriveKeywords(name, description);

  return {
    type: 'domain',
    autoInject: false,
    requiredSkills: [],
    description,
    promptTriggers: {
      keywords,
    },
  };
}

/**
 * Discover all skills in a directory by scanning SKILL.md files
 *
 * Iterates over immediate subdirectories, reads SKILL.md if present, and
 * builds a Record of skillName -> SkillRule.
 *
 * @param skillsDir - Root skills directory path
 * @returns Record of discovered skills
 */
export function discoverSkillsFromDirectory(skillsDir: string): Record<string, SkillRule> {
  const skills: Record<string, SkillRule> = {};

  if (!existsSync(skillsDir)) {
    return skills;
  }

  const entries = readdirSync(skillsDir);

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry);

    try {
      const stat = statSync(skillPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillFile = join(skillPath, 'SKILL.md');
    if (!existsSync(skillFile)) {
      continue;
    }

    try {
      const content = readFileSync(skillFile, 'utf-8');
      skills[entry] = buildSkillRuleFromFile(entry, content);
    } catch {
      // Skip unreadable skills
    }
  }

  return skills;
}

/**
 * Build a complete SkillRulesConfig from a skills directory
 *
 * This is the runtime fallback when no skill-rules.json is present.
 *
 * @param skillsDir - Root skills directory path
 * @returns SkillRulesConfig with discovered skills
 */
export function buildSkillRulesFromSkills(skillsDir: string): SkillRulesConfig {
  return {
    version: '1.0-discovered',
    skills: discoverSkillsFromDirectory(skillsDir),
  };
}

export { SKILL_RULES_PATH, SKILLS_DIR };

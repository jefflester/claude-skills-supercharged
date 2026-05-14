/**
 * Output formatting for skill activation hook
 *
 * Handles all display formatting including skill injection banners,
 * already-loaded sections, recommended skills, and manual load reminders.
 */

import { join } from 'path';

import { SKILLS_DIR } from './constants.js';
import type { CommandRule } from './types.js';

// Emoji banners are intentional — they help visually separate injected sections in Claude's context.

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function validateSkillName(name: string): boolean {
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes(':') || name.includes('\0')) {
    return false;
  }
  if (name.length === 0 || name.length > 255) {
    return false;
  }
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    return false;
  }
  return true;
}

function sanitizeCommandName(commandName: string): string {
  return commandName
    .replace(/[\r\n\t]/g, ' ')
    .replace(/^\/+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMarkdownLinkTarget(target: string): string {
  return /\s/.test(target) ? `<${target}>` : target;
}

function formatCommandReference(
  commandName: string,
  commandRules: Record<string, CommandRule>
): string {
  const safeCommandName = sanitizeCommandName(commandName);
  const sourcePath = commandRules[commandName]?.sourcePath;
  if (!sourcePath || sourcePath.includes('..')) {
    return `/${safeCommandName}`;
  }

  return `[$${safeCommandName}](${formatMarkdownLinkTarget(sourcePath)})`;
}

function formatSkillReference(skillName: string, skillsDir = SKILLS_DIR): string {
  if (!validateSkillName(skillName)) {
    return `$${skillName}`;
  }
  const skillPath = join(skillsDir, skillName, 'SKILL.md');
  return `[$${skillName}](${formatMarkdownLinkTarget(skillPath)})`;
}

/**
 * Inject skill pointers into system context
 *
 * Keeps system context lightweight by referencing SKILL.md files instead of
 * embedding full skill bodies.
 *
 * @param skillNames - Names of skills to reference
 * @param projectDir - Skills root directory
 * @returns Formatted skill injection output
 */
export function injectSkillContent(skillNames: string[], projectDir?: string): string {
  const resolvedDir = projectDir || SKILLS_DIR;

  if (skillNames.length === 0) return '';

  let output = '\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '📚 AUTO-REFERENCED SKILLS\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  for (const skillName of skillNames) {
    output += `  → ${formatSkillReference(skillName, resolvedDir)}\n`;
  }

  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += `Referenced ${skillNames.length} skill(s): ${skillNames.join(', ')}\n`;
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  return output;
}

/**
 * Format skill activation check banner
 *
 * Shows header banner for skill activation check section with decorator lines.
 *
 * @returns Formatted banner string
 */
export function formatActivationBanner(): string {
  let output = '';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '🎯 SKILL ACTIVATION CHECK\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  return output;
}

/**
 * Format just-injected skills section
 *
 * Shows skills that were just loaded in this turn with their injection type.
 *
 * @param injectedSkills - Skills that were just injected
 * @param criticalSkills - Skills injected as critical
 * @param affinitySkills - Skills injected via affinity
 * @param promotedSkills - Skills promoted from suggested
 * @returns Formatted section string
 */
export function formatJustInjectedSection(
  injectedSkills: string[],
  criticalSkills: string[],
  affinitySkills: string[],
  promotedSkills: string[]
): string {
  if (injectedSkills.length === 0) return '';

  let output = '\n📚 JUST REFERENCED:\n';

  injectedSkills.forEach((skill) => {
    let label = '';
    if (affinitySkills.includes(skill)) {
      label = ' (affinity)';
    } else if (promotedSkills.includes(skill)) {
      label = ' (promoted)';
    } else if (criticalSkills.includes(skill)) {
      label = ' (critical)';
    }
    output += `  → ${formatSkillReference(skill)}${label}\n`;
  });

  return output;
}

/**
 * Format already-loaded skills section
 *
 * Shows skills that were loaded in previous turns (for user awareness).
 * Only shown when no new skills are being injected.
 *
 * @param alreadyLoaded - Skills already acknowledged in this conversation
 * @returns Formatted section string
 */
export function formatAlreadyLoadedSection(alreadyLoaded: string[]): string {
  if (alreadyLoaded.length === 0) return '';

  let output = '\n✓ ALREADY REFERENCED:\n';
  alreadyLoaded.forEach((name) => {
    output += `  → ${formatSkillReference(name)}\n`;
  });
  return output;
}

/**
 * Format recommended skills section
 *
 * Shows skills that were suggested but not auto-loaded (available for manual loading).
 *
 * @param recommendedSkills - Skills in suggested tier (0.50-0.65 confidence)
 * @param scores - Optional confidence scores to display
 * @returns Formatted section string
 */
export function formatRecommendedSection(
  recommendedSkills: string[],
  scores?: Record<string, number>
): string {
  if (recommendedSkills.length === 0) return '';

  let output = '\n📚 RECOMMENDED SKILLS (not auto-loaded):\n';
  recommendedSkills.forEach((name) => {
    output += `  → ${formatSkillReference(name)}`;
    if (scores && scores[name]) {
      output += ` (${scores[name].toFixed(2)})`;
    }
    output += '\n';
  });
  output += '\nOptional: Open referenced SKILL.md if needed\n';
  return output;
}

/**
 * Format closing banner for skill activation check
 *
 * @returns Formatted closing banner
 */
export function formatClosingBanner(): string {
  return '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
}

/**
 * Format mandatory command references (names + metadata only)
 */
export function formatMandatoryCommandReferences(
  requiredCommands: string[],
  commandRules: Record<string, CommandRule>,
  scores?: Record<string, number>
): string {
  if (requiredCommands.length === 0) return '';

  let output = '\n🧭 REQUIRED COMMANDS:\n';
  for (const commandName of requiredCommands) {
    output += `  → ${formatCommandReference(commandName, commandRules)}`;
    if (scores && typeof scores[commandName] === 'number') {
      output += ` (${scores[commandName].toFixed(2)})`;
    }
    output += '\n';
  }

  return output;
}

/**
 * Format suggested command references (names + metadata only)
 */
export function formatSuggestedCommandReferences(
  suggestedCommands: string[],
  commandRules: Record<string, CommandRule>,
  scores?: Record<string, number>
): string {
  if (suggestedCommands.length === 0) return '';

  let output = '\n🧭 SUGGESTED COMMANDS:\n';
  for (const commandName of suggestedCommands) {
    output += `  → ${formatCommandReference(commandName, commandRules)}`;
    if (scores && typeof scores[commandName] === 'number') {
      output += ` (${scores[commandName].toFixed(2)})`;
    }
    output += '\n';
  }

  return output;
}

export function formatAlreadyLoadedCommandReferences(
  commandNames: string[],
  commandRules: Record<string, CommandRule> = {}
): string {
  if (commandNames.length === 0) return '';

  let output = '\n✓ ALREADY LOADED COMMANDS:\n';
  for (const commandName of commandNames) {
    output += `  → ${formatCommandReference(commandName, commandRules)}\n`;
  }

  return output;
}

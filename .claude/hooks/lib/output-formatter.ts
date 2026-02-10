/**
 * Output formatting for skill activation hook
 *
 * Handles all display formatting including skill injection banners,
 * already-loaded sections, recommended skills, and manual load reminders.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Inject skill content into system context
 *
 * Reads skill files and formats them with XML tags for Claude to process.
 * Returns formatted string with banner and skill content.
 *
 * @param skillNames - Names of skills to inject
 * @param projectDir - Project root directory
 * @returns Formatted skill injection output
 */
export function injectSkillContent(skillNames: string[], projectDir: string): string {
  if (skillNames.length === 0) return '';

  let output = '\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '📚 AUTO-LOADED SKILLS\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  for (const skillName of skillNames) {
    const skillPath = join(projectDir, '.claude', 'skills', skillName, 'SKILL.md');

    if (existsSync(skillPath)) {
      try {
        const skillContent = readFileSync(skillPath, 'utf-8');

        output += `<skill name="${skillName}">\n`;
        output += skillContent;
        output += `\n</skill>\n\n`;
      } catch (err) {
        console.error(`⚠️ Failed to load skill ${skillName}:`, err);
      }
    } else {
      console.warn(`⚠️ Skill file not found: ${skillPath}`);
    }
  }

  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += `Loaded ${skillNames.length} skill(s): ${skillNames.join(', ')}\n`;
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

  let output = '\n📚 JUST LOADED:\n';

  injectedSkills.forEach((skill) => {
    let label = '';
    if (affinitySkills.includes(skill)) {
      label = ' (affinity)';
    } else if (promotedSkills.includes(skill)) {
      label = ' (promoted)';
    } else if (criticalSkills.includes(skill)) {
      label = ' (critical)';
    }
    output += `  → ${skill}${label}\n`;
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

  let output = '\n✓ ALREADY LOADED:\n';
  alreadyLoaded.forEach((name) => {
    output += `  → ${name}\n`;
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
    output += `  → ${name}`;
    if (scores && scores[name]) {
      output += ` (${scores[name].toFixed(2)})`;
    }
    output += '\n';
  });
  output += '\nOptional: Use Skill tool to load if needed\n';
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

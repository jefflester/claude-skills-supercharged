/**
 * Intent analysis result scoring and categorization
 *
 * Categorizes skills by confidence thresholds (required vs suggested)
 * and provides debug output formatting for AI analysis results.
 */

import {
  CONFIDENCE_THRESHOLD,
  SUGGESTED_THRESHOLD,
  MAX_REQUIRED_SKILLS,
  MAX_SUGGESTED_SKILLS,
  COMMAND_CONFIDENCE_THRESHOLD,
  COMMAND_SUGGESTED_THRESHOLD,
  MAX_REQUIRED_COMMANDS,
  MAX_SUGGESTED_COMMANDS,
} from './constants.js';
import type { IntentAnalysis, AnalysisResult } from './types.js';

/**
 * Categorize skills by confidence thresholds
 *
 * Sorts skills into required (>0.65) and suggested (0.50-0.65) tiers,
 * limiting each to max counts.
 *
 * @param analysis - Raw intent analysis from AI
 * @returns Categorized result with required and suggested skills
 */
export function categorizeSkills(analysis: IntentAnalysis): AnalysisResult {
  // Validate input - guard against malformed API responses
  if (!Array.isArray(analysis.skills)) {
    return { required: [], suggested: [], requiredCommands: [], suggestedCommands: [], commandScores: {} };
  }

  const required = analysis.skills
    .filter((s) => s.confidence > CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_REQUIRED_SKILLS)
    .map((s) => s.name);

  const suggested = analysis.skills
    .filter((s) => s.confidence >= SUGGESTED_THRESHOLD && s.confidence <= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_SUGGESTED_SKILLS)
    .map((s) => s.name);

  return { required, suggested, requiredCommands: [], suggestedCommands: [], commandScores: {} };
}

/**
 * Categorize commands by confidence thresholds
 */
export function categorizeCommands(analysis: IntentAnalysis): AnalysisResult {
  if (!Array.isArray(analysis.commands)) {
    return { required: [], suggested: [], requiredCommands: [], suggestedCommands: [], commandScores: {} };
  }

  const required = analysis.commands
    .filter((c) => c.confidence >= COMMAND_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_REQUIRED_COMMANDS)
    .map((c) => c.name);

  const suggested = analysis.commands
    .filter(
      (c) =>
        c.confidence >= COMMAND_SUGGESTED_THRESHOLD &&
        c.confidence < COMMAND_CONFIDENCE_THRESHOLD
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_SUGGESTED_COMMANDS)
    .map((c) => c.name);

  return { required, suggested, requiredCommands: [], suggestedCommands: [], commandScores: {} };
}

/**
 * Format debug output for AI intent analysis
 *
 * Displays primary intent, all scored skills with tiers (REQUIRED/SUGGESTED/LOW),
 * and AI reasoning for each skill.
 *
 * @param analysis - Intent analysis result from AI
 */
export function formatDebugOutput(analysis: IntentAnalysis): void {
  console.error('\n━━━━━━ AI INTENT ANALYSIS DEBUG ━━━━━━'); // eslint-disable-line no-console
  console.error(`Primary Intent: ${analysis.primary_intent}`); // eslint-disable-line no-console
  const skillRankings =
    Array.isArray(analysis.skill_rankings) && analysis.skill_rankings.length > 0
      ? analysis.skill_rankings
      : analysis.skills;
  const rankingLabel =
    skillRankings === analysis.skills ? 'Returned Skills Scored' : 'All Skills Ranked';
  console.error(`\n${rankingLabel}:`); // eslint-disable-line no-console

  for (const skill of skillRankings.sort((a, b) => b.confidence - a.confidence)) {
    const tier =
      skill.confidence > CONFIDENCE_THRESHOLD
        ? 'REQUIRED'
        : skill.confidence >= SUGGESTED_THRESHOLD
          ? 'SUGGESTED'
          : 'LOW';
    console.error(`  ${skill.name.padEnd(25)} ${skill.confidence.toFixed(2)} [${tier}]`); // eslint-disable-line no-console
    if (skill.reason) {
      console.error(`    → ${skill.reason}`); // eslint-disable-line no-console
    }
  }

  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'); // eslint-disable-line no-console
}

/**
 * Build analysis result with optional debug scores
 *
 * Creates final result object, optionally including confidence scores
 * when debug mode is enabled.
 *
 * @param categorized - Categorized skills (required/suggested)
 * @param analysis - Original analysis with confidence scores
 * @param includeScores - Whether to include debug scores
 * @returns Analysis result with optional scores
 */
export function buildAnalysisResult(
  categorized: AnalysisResult,
  analysis: IntentAnalysis,
  includeScores: boolean
): AnalysisResult {
  if (!includeScores) {
    return {
      required: categorized.required,
      suggested: categorized.suggested,
      requiredCommands: categorized.requiredCommands,
      suggestedCommands: categorized.suggestedCommands,
      commandScores: categorized.commandScores,
    };
  }

  const scoreSource =
    Array.isArray(analysis.skill_rankings) && analysis.skill_rankings.length > 0
      ? analysis.skill_rankings
      : analysis.skills;

  const scores: Record<string, number> = {};
  for (const skill of scoreSource) {
    scores[skill.name] = skill.confidence;
  }

  return {
    required: categorized.required,
    suggested: categorized.suggested,
    scores,
    requiredCommands: categorized.requiredCommands,
    suggestedCommands: categorized.suggestedCommands,
    commandScores: categorized.commandScores,
  };
}

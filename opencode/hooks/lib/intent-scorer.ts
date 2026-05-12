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
    return { required: [], suggested: [] };
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

  return { required, suggested };
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
  console.error('\n━━━━━━ AI INTENT ANALYSIS DEBUG ━━━━━━');
  console.error(`Primary Intent: ${analysis.primary_intent}`);
  console.error('\nAll Skills Scored:');

  analysis.skills
    .sort((a, b) => b.confidence - a.confidence)
    .forEach((skill) => {
      const tier =
        skill.confidence > CONFIDENCE_THRESHOLD
          ? 'REQUIRED'
          : skill.confidence >= SUGGESTED_THRESHOLD
            ? 'SUGGESTED'
            : 'LOW';
      console.error(`  ${skill.name.padEnd(25)} ${skill.confidence.toFixed(2)} [${tier}]`);
      console.error(`    → ${skill.reason}`);
    });

  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
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
  const result: AnalysisResult = {
    required: categorized.required,
    suggested: categorized.suggested,
  };

  if (includeScores) {
    result.scores = {};
    analysis.skills.forEach((skill) => {
      result.scores![skill.name] = skill.confidence;
    });
  }

  return result;
}

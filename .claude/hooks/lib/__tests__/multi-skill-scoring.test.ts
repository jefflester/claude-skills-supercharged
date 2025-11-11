import { describe, it, expect } from 'vitest';

/**
 * Tests for multi-skill scoring and injection logic
 *
 * These tests verify that the skill injection system correctly handles
 * scenarios where multiple skills have high confidence scores, ensuring
 * that only the top 2 skills are injected and remaining skills are properly
 * categorized as suggested.
 */

interface SkillScore {
  name: string;
  confidence: number;
}

interface AnalysisResult {
  required: string[];
  suggested: string[];
}

/**
 * Categorize skills into required/suggested based on confidence thresholds
 * (Mirrors intent-analyzer.ts lines 123-134)
 */
function categorizeSkills(
  scores: SkillScore[],
  confidenceThreshold: number,
  suggestedThreshold: number,
  maxRequired: number,
  maxSuggested: number
): AnalysisResult {
  const required = scores
    .filter((s) => s.confidence > confidenceThreshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxRequired)
    .map((s) => s.name);

  const suggested = scores
    .filter((s) => s.confidence >= suggestedThreshold && s.confidence <= confidenceThreshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxSuggested)
    .map((s) => s.name);

  return { required, suggested };
}

interface PromotionResult {
  toInject: string[];
  promoted: string[];
  remainingSuggested: string[];
}

/**
 * Apply promotion logic: fill empty critical slots with top suggested skills
 * (Mirrors skill-filtering.test.ts applyInjectionLimits function)
 */
function applyPromotion(
  required: string[],
  suggested: string[],
  standardLimit: number
): PromotionResult {
  const toInject = [...required];
  const promoted: string[] = [];

  // Calculate how many slots are empty
  const needed = standardLimit - Math.min(toInject.length, standardLimit);

  if (needed > 0 && suggested.length > 0) {
    // Promote top N suggested skills to fill empty slots
    const toPromote = suggested.slice(0, needed);
    promoted.push(...toPromote);
    toInject.push(...toPromote);
  }

  // Remaining suggested skills (not promoted)
  const remainingSuggested = suggested.filter((s) => !promoted.includes(s));

  return { toInject, promoted, remainingSuggested };
}

describe('Multi-Skill Scoring', () => {
  const CONFIDENCE_THRESHOLD = 0.65;
  const SUGGESTED_THRESHOLD = 0.5;
  const MAX_REQUIRED_SKILLS = 2;
  const MAX_SUGGESTED_SKILLS = 2;

  describe('Multiple High-Confidence Skills', () => {
    it('should inject only top 2 when 3+ skills exceed confidence threshold', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.85 },
        { name: 'skill-c', confidence: 0.75 },
        { name: 'skill-d', confidence: 0.7 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toHaveLength(2);
      expect(result.required).toEqual(['skill-a', 'skill-b']);
    });

    it('should preserve order by confidence score (highest first)', () => {
      const scores: SkillScore[] = [
        { name: 'skill-c', confidence: 0.75 }, // Out of order
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.85 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      // Should be sorted by confidence descending
      expect(result.required).toEqual(['skill-a', 'skill-b']);
    });

    it('should handle 5+ high-confidence skills correctly', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.95 },
        { name: 'skill-b', confidence: 0.9 },
        { name: 'skill-c', confidence: 0.85 },
        { name: 'skill-d', confidence: 0.8 },
        { name: 'skill-e', confidence: 0.75 },
        { name: 'skill-f', confidence: 0.7 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      // Only top 2 injected
      expect(result.required).toHaveLength(2);
      expect(result.required).toEqual(['skill-a', 'skill-b']);

      // Others not in suggested (they're above threshold but truncated)
      expect(result.suggested).toHaveLength(0);
    });
  });

  describe('Confidence Threshold Edge Cases', () => {
    it('should include skill with confidence exactly at threshold', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.65 }, // Exactly at threshold
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      // Threshold is > 0.65, so 0.65 should NOT be included
      expect(result.required).toEqual(['skill-a']);
      expect(result.suggested).toEqual(['skill-b']); // Should be suggested instead
    });

    it('should exclude skill with confidence just below threshold', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.6499 }, // Just below
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['skill-a']);
      expect(result.suggested).toEqual(['skill-b']);
    });

    it('should include skill with confidence just above threshold', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.66 }, // Just above
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['skill-a', 'skill-b']);
    });
  });

  describe('Suggested Skills Handling', () => {
    it('should categorize skills in 0.50-0.65 range as suggested', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.6 }, // Suggested range
        { name: 'skill-c', confidence: 0.55 }, // Suggested range
        { name: 'skill-d', confidence: 0.52 }, // Suggested range
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['skill-a']);
      expect(result.suggested).toHaveLength(2); // Max 2 suggested
      expect(result.suggested).toEqual(['skill-b', 'skill-c']); // Top 2 by confidence
    });

    it('should exclude skills below suggested threshold (< 0.5)', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.45 }, // Below suggested threshold
        { name: 'skill-c', confidence: 0.3 }, // Below suggested threshold
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['skill-a']);
      expect(result.suggested).toEqual([]); // None qualify
    });

    it('should limit suggested skills to MAX_SUGGESTED_SKILLS', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 },
        { name: 'skill-b', confidence: 0.64 },
        { name: 'skill-c', confidence: 0.62 },
        { name: 'skill-d', confidence: 0.6 },
        { name: 'skill-e', confidence: 0.58 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['skill-a']);
      expect(result.suggested).toHaveLength(2); // Limited to MAX_SUGGESTED_SKILLS
      expect(result.suggested).toEqual(['skill-b', 'skill-c']); // Top 2
    });
  });

  describe('Real-World Multi-Domain Scenarios', () => {
    it('should handle python + git-workflow work (both high confidence)', () => {
      // Simulates: "Refactor Python code and commit with proper messages"
      const scores: SkillScore[] = [
        { name: 'python-best-practices', confidence: 0.9 },
        { name: 'git-workflow', confidence: 0.85 },
        { name: 'skill-developer', confidence: 0.55 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['python-best-practices', 'git-workflow']);
      expect(result.suggested).toEqual(['skill-developer']);
    });

    it('should handle api-security + python work (both high confidence)', () => {
      // Simulates: "Build a secure API endpoint in Python"
      const scores: SkillScore[] = [
        { name: 'api-security', confidence: 0.9 },
        { name: 'python-best-practices', confidence: 0.85 },
        { name: 'skill-developer', confidence: 0.6 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['api-security', 'python-best-practices']);
      expect(result.suggested).toEqual(['skill-developer']);
    });

    it('should deprioritize keyword soup prompts (all mid-range scores)', () => {
      // Simulates: "Skill system check: python, git, api, skills"
      const scores: SkillScore[] = [
        { name: 'skill-developer', confidence: 0.75 }, // Highest (system check)
        { name: 'python-best-practices', confidence: 0.58 }, // Mentioned but not active work
        { name: 'git-workflow', confidence: 0.56 },
        { name: 'api-security', confidence: 0.54 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      // Only skill-developer exceeds 0.65
      expect(result.required).toEqual(['skill-developer']);
      // Top 2 from suggested range
      expect(result.suggested).toEqual(['python-best-practices', 'git-workflow']);
    });

    it('should handle api-security + git-workflow work (cross-domain)', () => {
      // Simulates: "Secure the API and document changes"
      const scores: SkillScore[] = [
        { name: 'api-security', confidence: 0.9 },
        { name: 'git-workflow', confidence: 0.75 },
        { name: 'skill-developer', confidence: 0.6 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['api-security', 'git-workflow']);
      expect(result.suggested).toEqual(['skill-developer']);
    });
  });

  describe('Empty and Edge Cases', () => {
    it('should handle no high-confidence skills (all suggested)', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.6 },
        { name: 'skill-b', confidence: 0.55 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual([]);
      expect(result.suggested).toEqual(['skill-a', 'skill-b']);
    });

    it('should handle empty skill list', () => {
      const scores: SkillScore[] = [];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual([]);
      expect(result.suggested).toEqual([]);
    });

    it('should handle single high-confidence skill', () => {
      const scores: SkillScore[] = [{ name: 'skill-a', confidence: 0.9 }];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual(['skill-a']);
      expect(result.suggested).toEqual([]);
    });

    it('should handle all skills below all thresholds', () => {
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.4 },
        { name: 'skill-b', confidence: 0.3 },
        { name: 'skill-c', confidence: 0.2 },
      ];

      const result = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(result.required).toEqual([]);
      expect(result.suggested).toEqual([]); // All below 0.5
    });
  });

  describe('Promotion Workflow', () => {
    const STANDARD_LIMIT = 2;

    it('should promote top suggested skill when 1 critical + multiple suggested', () => {
      // Simulate AI scoring: 1 critical (>0.65), 2 suggested (0.50-0.65)
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.7 }, // Critical
        { name: 'skill-b', confidence: 0.6 }, // Suggested
        { name: 'skill-c', confidence: 0.55 }, // Suggested
      ];

      // Categorize
      const categorized = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(categorized.required).toEqual(['skill-a']);
      expect(categorized.suggested).toEqual(['skill-b', 'skill-c']);

      // Apply promotion
      const promoted = applyPromotion(categorized.required, categorized.suggested, STANDARD_LIMIT);

      // Should inject skill-a (critical) + skill-b (promoted)
      expect(promoted.toInject).toHaveLength(2);
      expect(promoted.toInject).toEqual(['skill-a', 'skill-b']);
      expect(promoted.promoted).toEqual(['skill-b']); // skill-b was promoted
      expect(promoted.remainingSuggested).toEqual(['skill-c']); // skill-c remains suggested
    });

    it('should promote top 2 suggested when 0 critical + multiple suggested', () => {
      // Simulate: All skills in suggested range (0.50-0.65)
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.6 },
        { name: 'skill-b', confidence: 0.58 },
        { name: 'skill-c', confidence: 0.55 },
        { name: 'skill-d', confidence: 0.52 },
      ];

      const categorized = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(categorized.required).toEqual([]);
      expect(categorized.suggested).toEqual(['skill-a', 'skill-b']); // Limited to MAX_SUGGESTED_SKILLS

      const promoted = applyPromotion(categorized.required, categorized.suggested, STANDARD_LIMIT);

      // Should promote top 2 suggested to fill all slots
      expect(promoted.toInject).toHaveLength(2);
      expect(promoted.toInject).toEqual(['skill-a', 'skill-b']);
      expect(promoted.promoted).toEqual(['skill-a', 'skill-b']); // Both promoted
      expect(promoted.remainingSuggested).toEqual([]); // None left
    });

    it('should promote higher-confidence suggested skill (respects ordering)', () => {
      // Simulate: 1 critical, 2 suggested (out of confidence order)
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 }, // Critical
        { name: 'skill-b', confidence: 0.55 }, // Suggested (lower)
        { name: 'skill-c', confidence: 0.62 }, // Suggested (higher)
      ];

      const categorized = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(categorized.required).toEqual(['skill-a']);
      expect(categorized.suggested).toEqual(['skill-c', 'skill-b']); // Sorted by confidence

      const promoted = applyPromotion(categorized.required, categorized.suggested, STANDARD_LIMIT);

      // Should promote skill-c (0.62) over skill-b (0.55)
      expect(promoted.toInject).toEqual(['skill-a', 'skill-c']);
      expect(promoted.promoted).toEqual(['skill-c']);
      expect(promoted.remainingSuggested).toEqual(['skill-b']);
    });

    it('should NOT promote when critical slots are full', () => {
      // Simulate: 2 critical skills (slots full) + suggested skills
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.9 }, // Critical
        { name: 'skill-b', confidence: 0.85 }, // Critical
        { name: 'skill-c', confidence: 0.6 }, // Suggested
      ];

      const categorized = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(categorized.required).toEqual(['skill-a', 'skill-b']);
      expect(categorized.suggested).toEqual(['skill-c']);

      const promoted = applyPromotion(categorized.required, categorized.suggested, STANDARD_LIMIT);

      // Should NOT promote skill-c (slots are full)
      expect(promoted.toInject).toHaveLength(2);
      expect(promoted.toInject).toEqual(['skill-a', 'skill-b']);
      expect(promoted.promoted).toEqual([]); // Nothing promoted
      expect(promoted.remainingSuggested).toEqual(['skill-c']); // Remains suggested
    });

    it('should promote single suggested when 1 critical + 1 suggested', () => {
      // Simulate: 1 critical, 1 suggested
      const scores: SkillScore[] = [
        { name: 'skill-a', confidence: 0.7 }, // Critical
        { name: 'skill-b', confidence: 0.55 }, // Suggested
      ];

      const categorized = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(categorized.required).toEqual(['skill-a']);
      expect(categorized.suggested).toEqual(['skill-b']);

      const promoted = applyPromotion(categorized.required, categorized.suggested, STANDARD_LIMIT);

      // Should promote the single suggested skill
      expect(promoted.toInject).toHaveLength(2);
      expect(promoted.toInject).toEqual(['skill-a', 'skill-b']);
      expect(promoted.promoted).toEqual(['skill-b']);
      expect(promoted.remainingSuggested).toEqual([]);
    });

    it('should handle empty suggested list (no promotion possible)', () => {
      // Simulate: 1 critical, no suggested
      const scores: SkillScore[] = [{ name: 'skill-a', confidence: 0.7 }];

      const categorized = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(categorized.required).toEqual(['skill-a']);
      expect(categorized.suggested).toEqual([]);

      const promoted = applyPromotion(categorized.required, categorized.suggested, STANDARD_LIMIT);

      // Should inject only the critical skill (no promotion possible)
      expect(promoted.toInject).toHaveLength(1);
      expect(promoted.toInject).toEqual(['skill-a']);
      expect(promoted.promoted).toEqual([]);
      expect(promoted.remainingSuggested).toEqual([]);
    });

    it('should handle real-world scenario: python work with multiple related skills', () => {
      // Simulate: "Working on Python" → python-best-practices (critical) + related skills (suggested)
      const scores: SkillScore[] = [
        { name: 'python-best-practices', confidence: 0.9 }, // Critical
        { name: 'api-security', confidence: 0.62 }, // Suggested (high)
        { name: 'git-workflow', confidence: 0.58 }, // Suggested (medium)
        { name: 'skill-developer', confidence: 0.54 }, // Suggested (low)
      ];

      const categorized = categorizeSkills(
        scores,
        CONFIDENCE_THRESHOLD,
        SUGGESTED_THRESHOLD,
        MAX_REQUIRED_SKILLS,
        MAX_SUGGESTED_SKILLS
      );

      expect(categorized.required).toEqual(['python-best-practices']);
      expect(categorized.suggested).toEqual(['api-security', 'git-workflow']); // Top 2

      const promoted = applyPromotion(categorized.required, categorized.suggested, STANDARD_LIMIT);

      // Should promote api-security (highest suggested)
      expect(promoted.toInject).toEqual(['python-best-practices', 'api-security']);
      expect(promoted.promoted).toEqual(['api-security']);
      expect(promoted.remainingSuggested).toEqual(['git-workflow']);
    });
  });
});

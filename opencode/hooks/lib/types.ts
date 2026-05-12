/**
 * Centralized type definitions for the skill activation system
 *
 * This module contains all interfaces and types used across the hooks system,
 * providing a single source of truth for type definitions.
 */

/**
 * Skill confidence score from AI intent analysis
 */
export interface SkillConfidence {
  name: string;
  confidence: number;
  reason: string;
}

/**
 * AI intent analysis result from Anthropic API
 */
export interface IntentAnalysis {
  primary_intent: string;
  skills: SkillConfidence[];
}

/**
 * Categorized analysis result with required and suggested skills
 */
export interface AnalysisResult {
  required: string[];
  suggested: string[];
  fromCache?: boolean;
  scores?: Record<string, number>; // skill name -> confidence score (debug mode)
}

/**
 * Prompt trigger configuration
 */
export interface PromptTriggers {
  keywords?: string[];
}

/**
 * Skill rule configuration from skill-rules.json
 */
export interface SkillRule {
  type: 'guardrail' | 'domain';
  description?: string;
  autoInject?: boolean;
  requiredSkills?: string[];
  injectionOrder?: number;
  promptTriggers?: PromptTriggers;
  affinity?: string[]; // Bidirectional complementary skills (max 2)
}

/**
 * Skill rules configuration (skill-rules.json structure)
 */
export interface SkillRulesConfig {
  version: string;
  skills: Record<string, SkillRule>;
}

/**
 * Session state tracking acknowledged skills
 */
export interface SessionState {
  acknowledgedSkills: string[];
}

/**
 * Cache entry for intent analysis results
 */
export interface CacheEntry {
  timestamp: number;
  result: {
    required: string[];
    suggested: string[];
  };
}

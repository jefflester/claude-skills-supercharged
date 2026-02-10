/**
 * Configuration constants for skill activation system
 *
 * Most thresholds can be overridden via environment variables for tuning
 * without code changes. See inline comments for env var names.
 */

// Confidence thresholds for AI-powered skill detection
// Higher threshold (0.65) ensures only truly critical skills are auto-injected
// Lower threshold (0.50) allows for skill suggestions without forcing injection
// Override: SKILL_CONFIDENCE_THRESHOLD, SKILL_SUGGESTED_THRESHOLD
export const CONFIDENCE_THRESHOLD = parseFloat(
  process.env.SKILL_CONFIDENCE_THRESHOLD || '0.65'
);
export const SUGGESTED_THRESHOLD = parseFloat(process.env.SKILL_SUGGESTED_THRESHOLD || '0.50');

// Skill injection limits to prevent context overload
// Standard limit is 2 skills - prevents overwhelming Claude with too many guidelines
// Affinity skills are auto-injected free of slot cost (don't count toward limit)
export const MAX_REQUIRED_SKILLS = 2; // Maximum critical skills to auto-inject
export const MAX_SUGGESTED_SKILLS = 2; // Maximum recommended skills to suggest

// Short prompts use keyword matching instead of AI analysis
// Saves API costs and latency for simple prompts where intent is unclear
// Override: SKILL_SHORT_PROMPT_WORDS (default: 6 words)
export const SHORT_PROMPT_WORD_THRESHOLD = parseInt(
  process.env.SKILL_SHORT_PROMPT_WORDS || '6',
  10
);

// Cache configuration for AI intent analysis
// 1 hour TTL balances freshness vs API cost (~$0.0003 per analysis)
// 24 hour cleanup prevents unbounded cache growth
// Override: SKILL_CACHE_TTL_MS
export const CACHE_TTL_MS = parseInt(
  process.env.SKILL_CACHE_TTL_MS || String(60 * 60 * 1000),
  10
);
export const CACHE_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Dependency resolution defaults
// Skills without explicit injectionOrder use this value (mid-range 0-100)
export const DEFAULT_INJECTION_ORDER = 50;

// Debug mode toggle
// Controlled by CLAUDE_SKILLS_DEBUG=1 environment variable
export const DEBUG_ENABLED = process.env.CLAUDE_SKILLS_DEBUG === '1';

// Banner formatting
// Character width for visual consistency in terminal output
export const BANNER_WIDTH = 45;

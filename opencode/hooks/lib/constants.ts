/**
 * Configuration constants for skill activation system
 *
 * Most thresholds can be overridden via environment variables for tuning
 * without code changes. See inline comments for env var names.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Skills Directory Resolution ───────────────────────────────────────────────
// OPENCODE_SKILLS_DIR: Root directory containing SKILL.md files and skill-rules.json
// Priority: 1) env var (takes precedence), 2) auto-discovered global locations, 3) legacy .claude/skills

function getGlobalSkillsCandidates(): string[] {
  const home = homedir();
  const candidates: string[] = [];

  // Windows common locations
  if (process.platform === 'win32') {
    if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'opencode', 'skills'));
    if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'opencode', 'skills'));
    candidates.push(join(home, 'AppData', 'Roaming', 'opencode', 'skills'));
    candidates.push(join(home, 'AppData', 'Local', 'opencode', 'skills'));
    candidates.push('C:\\Program Files\\opencode\\skills');
  }

  // macOS common locations
  if (process.platform === 'darwin') {
    candidates.push(join(home, 'Library', 'Application Support', 'opencode', 'skills'));
    candidates.push('/usr/local/share/opencode/skills');
    candidates.push('/opt/opencode/skills');
  }

  // Linux common locations
  if (process.platform === 'linux') {
    const xdgData = process.env.XDG_DATA_HOME;
    if (xdgData) candidates.push(join(xdgData, 'opencode', 'skills'));
    candidates.push(join(home, '.local', 'share', 'opencode', 'skills'));
    candidates.push(join(home, '.config', 'opencode', 'skills'));
    candidates.push('/usr/share/opencode/skills');
    candidates.push('/usr/local/share/opencode/skills');
    candidates.push('/opt/opencode/skills');
  }

  // Legacy cross-platform fallback (for existing installs)
  candidates.push(join(home, '.opencode', 'skills'));

  return candidates;
}

function resolveSkillsDirectory(projectDirectory: string): string {
  if (process.env.OPENCODE_SKILLS_DIR) {
    return process.env.OPENCODE_SKILLS_DIR;
  }

  for (const candidate of getGlobalSkillsCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return join(projectDirectory, '.claude', 'skills');
}

export const SKILLS_DIR = resolveSkillsDirectory(
  process.env.OPENCODE_PROJECT_DIR || process.cwd()
);

// OPENCODE_SKILL_RULES_PATH: Explicit path to skill-rules.json
// If unset, defaults to <SKILLS_DIR>/skill-rules.json
export const SKILL_RULES_PATH =
  process.env.OPENCODE_SKILL_RULES_PATH || join(SKILLS_DIR, 'skill-rules.json');

// OPENCODE_SKILLS_STATE_DIR: Directory for session state files
// Defaults to <project>/.claude/hooks/state if it exists, otherwise <plugin-dir>/state
export const SKILLS_STATE_DIR =
  process.env.OPENCODE_SKILLS_STATE_DIR ||
  (() => {
    const legacy = join(
      process.env.OPENCODE_PROJECT_DIR || process.cwd(),
      '.claude',
      'hooks',
      'state'
    );
    return existsSync(legacy) ? legacy : join(process.cwd(), 'state');
  })();

// OPENCODE_SKILLS_CACHE_DIR: Directory for intent-analysis cache
// Defaults to <project>/.opencode/cache/intent-analysis
export const SKILLS_CACHE_DIR =
  process.env.OPENCODE_SKILLS_CACHE_DIR ||
  join(process.env.OPENCODE_PROJECT_DIR || process.cwd(), '.opencode', 'cache', 'intent-analysis');

// OPENCODE_SKILLS_PROMPT_TEMPLATE: Optional custom prompt template for intent analysis
export const SKILLS_PROMPT_TEMPLATE = process.env.OPENCODE_SKILLS_PROMPT_TEMPLATE || '';

// OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE: How keyword fallback handles domain skills
//   off      — keyword fallback only returns guardrail skills
//   suggest  — keyword fallback returns domain skills as suggested
//   inject   — keyword fallback returns domain skills as required (critical)
// Default: suggest (conservative but useful)
export const FALLBACK_DOMAIN_MODE = (process.env.OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE || 'suggest') as
  | 'off'
  | 'suggest'
  | 'inject';

// Confidence thresholds for AI-powered skill detection
// Higher threshold (0.65) ensures only truly critical skills are auto-injected
// Lower threshold (0.50) allows for skill suggestions without forcing injection
// Override: SKILL_CONFIDENCE_THRESHOLD, SKILL_SUGGESTED_THRESHOLD
export const CONFIDENCE_THRESHOLD = parseFloat(
  process.env.SKILL_CONFIDENCE_THRESHOLD || '0.65'
);
export const SUGGESTED_THRESHOLD = parseFloat(process.env.SKILL_SUGGESTED_THRESHOLD || '0.50');

// Skill injection limits to prevent context overload
// Standard limit is 10 skills - allows broader skill coverage when intent is clear
// Affinity skills are auto-injected free of slot cost (don't count toward limit)
export const MAX_REQUIRED_SKILLS = 10; // Maximum critical skills to auto-inject
export const MAX_SUGGESTED_SKILLS = 10; // Maximum recommended skills to suggest

// Short prompts use keyword matching instead of AI analysis
// Saves API costs and latency for simple prompts where intent is unclear
// Override: SKILL_SHORT_PROMPT_WORDS (default: 14 words; AI runs at 15+ words)
export const SHORT_PROMPT_WORD_THRESHOLD = parseInt(
  process.env.SKILL_SHORT_PROMPT_WORDS || '14',
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
// Controlled by OPENCODE_SKILLS_DEBUG=1 environment variable
export const DEBUG_ENABLED = process.env.OPENCODE_SKILLS_DEBUG === '1';

// Banner formatting
// Character width for visual consistency in terminal output
export const BANNER_WIDTH = 45;

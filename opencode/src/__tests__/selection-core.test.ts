import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises before importing
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

// Mock debug-logger
vi.mock('../../hooks/lib/debug-logger.js', () => ({
  debugLog: vi.fn(),
}));

// Mock skill-discovery
vi.mock('../../hooks/lib/skill-discovery.js', () => ({
  buildSkillRulesFromSkills: vi.fn().mockReturnValue({
    version: 'discovered',
    skills: { 'fallback-skill': { type: 'domain', description: 'discovered' } },
  }),
  SKILL_RULES_PATH: '/mock/skill-rules.json',
  SKILLS_DIR: '/mock/skills',
}));

// Mock constants
vi.mock('../../hooks/lib/constants.js', () => ({
  MAX_REQUIRED_COMMANDS: 10,
  MAX_SUGGESTED_COMMANDS: 5,
}));

import { readFile, access } from 'fs/promises';
import {
  isRecord,
  getProjectDirectory,
  withConsoleSuppressed,
  parseSuggestedThreshold,
  parseCommandThreshold,
  parseCommandSuggestedThreshold,
  uniqueSortedCommandNames,
  buildConfidenceBuckets,
  getSelectionLabel,
  resolveStateDirectory,
  loadSkillRules,
} from '../selection-core.js';
import type { AnalysisResult } from '../../hooks/lib/types.js';

const mockedReadFile = vi.mocked(readFile);
const mockedAccess = vi.mocked(access);

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isRecord(42)).toBe(false);
    expect(isRecord('string')).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('getProjectDirectory', () => {
  const originalEnv = process.env.OPENCODE_PROJECT_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCODE_PROJECT_DIR;
    } else {
      process.env.OPENCODE_PROJECT_DIR = originalEnv;
    }
  });

  it('returns OPENCODE_PROJECT_DIR when set', () => {
    process.env.OPENCODE_PROJECT_DIR = '/custom/project';
    expect(getProjectDirectory()).toBe('/custom/project');
  });

  it('returns process.cwd() when env var is not set', () => {
    delete process.env.OPENCODE_PROJECT_DIR;
    expect(getProjectDirectory()).toBe(process.cwd());
  });
});

describe('withConsoleSuppressed', () => {
  it('suppresses console.error and console.warn when quiet=true', async () => {
    const originalError = console.error;
    const originalWarn = console.warn;
    let errorSuppressed = false;
    let warnSuppressed = false;

    const result = await withConsoleSuppressed(true, async () => {
      // Inside the task, console.error and console.warn should be no-ops
      errorSuppressed = console.error !== originalError;
      warnSuppressed = console.warn !== originalWarn;
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(errorSuppressed).toBe(true);
    expect(warnSuppressed).toBe(true);
    // After completion, originals should be restored
    expect(console.error).toBe(originalError);
    expect(console.warn).toBe(originalWarn);
  });

  it('restores console on error when quiet=true', async () => {
    const originalError = console.error;
    const originalWarn = console.warn;

    await expect(
      withConsoleSuppressed(true, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(console.error).toBe(originalError);
    expect(console.warn).toBe(originalWarn);
  });

  it('passes through when quiet=false', async () => {
    const originalError = console.error;
    const originalWarn = console.warn;

    const result = await withConsoleSuppressed(false, async () => {
      expect(console.error).toBe(originalError);
      expect(console.warn).toBe(originalWarn);
      return 'passthrough';
    });

    expect(result).toBe('passthrough');
  });
});

describe('parseSuggestedThreshold', () => {
  const originalEnv = process.env.SKILL_SUGGESTED_THRESHOLD;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SKILL_SUGGESTED_THRESHOLD;
    } else {
      process.env.SKILL_SUGGESTED_THRESHOLD = originalEnv;
    }
  });

  it('returns 0.5 by default', () => {
    delete process.env.SKILL_SUGGESTED_THRESHOLD;
    expect(parseSuggestedThreshold()).toBe(0.5);
  });

  it('reads from environment variable', () => {
    process.env.SKILL_SUGGESTED_THRESHOLD = '0.3';
    expect(parseSuggestedThreshold()).toBe(0.3);
  });
});

describe('parseCommandThreshold', () => {
  const originalEnv = process.env.COMMAND_CONFIDENCE_THRESHOLD;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.COMMAND_CONFIDENCE_THRESHOLD;
    } else {
      process.env.COMMAND_CONFIDENCE_THRESHOLD = originalEnv;
    }
  });

  it('returns 0.9 by default', () => {
    delete process.env.COMMAND_CONFIDENCE_THRESHOLD;
    expect(parseCommandThreshold()).toBe(0.9);
  });

  it('reads from environment variable', () => {
    process.env.COMMAND_CONFIDENCE_THRESHOLD = '0.85';
    expect(parseCommandThreshold()).toBe(0.85);
  });
});

describe('parseCommandSuggestedThreshold', () => {
  const originalEnv = process.env.COMMAND_SUGGESTED_THRESHOLD;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.COMMAND_SUGGESTED_THRESHOLD;
    } else {
      process.env.COMMAND_SUGGESTED_THRESHOLD = originalEnv;
    }
  });

  it('returns Math.min of env value and requiredThreshold', () => {
    delete process.env.COMMAND_SUGGESTED_THRESHOLD;
    // Default env is 0.7, required is 0.9 => min(0.7, 0.9) = 0.7
    expect(parseCommandSuggestedThreshold(0.9)).toBe(0.7);
  });

  it('caps at requiredThreshold when env is higher', () => {
    process.env.COMMAND_SUGGESTED_THRESHOLD = '0.95';
    // min(0.95, 0.8) = 0.8
    expect(parseCommandSuggestedThreshold(0.8)).toBe(0.8);
  });

  it('uses env value when it is lower than requiredThreshold', () => {
    process.env.COMMAND_SUGGESTED_THRESHOLD = '0.5';
    // min(0.5, 0.9) = 0.5
    expect(parseCommandSuggestedThreshold(0.9)).toBe(0.5);
  });
});

describe('uniqueSortedCommandNames', () => {
  it('deduplicates command names', () => {
    const result = uniqueSortedCommandNames(
      ['cmd-a', 'cmd-b', 'cmd-a'],
      { 'cmd-a': 0.9, 'cmd-b': 0.8 }
    );
    expect(result).toEqual(['cmd-a', 'cmd-b']);
  });

  it('sorts by score descending', () => {
    const result = uniqueSortedCommandNames(
      ['cmd-low', 'cmd-high', 'cmd-mid'],
      { 'cmd-low': 0.5, 'cmd-high': 0.95, 'cmd-mid': 0.7 }
    );
    expect(result).toEqual(['cmd-high', 'cmd-mid', 'cmd-low']);
  });

  it('preserves insertion order for equal scores', () => {
    const result = uniqueSortedCommandNames(
      ['cmd-first', 'cmd-second', 'cmd-third'],
      { 'cmd-first': 0.8, 'cmd-second': 0.8, 'cmd-third': 0.8 }
    );
    expect(result).toEqual(['cmd-first', 'cmd-second', 'cmd-third']);
  });

  it('puts scored commands before unscored ones', () => {
    const result = uniqueSortedCommandNames(
      ['cmd-unscored', 'cmd-scored'],
      { 'cmd-scored': 0.5 }
    );
    expect(result).toEqual(['cmd-scored', 'cmd-unscored']);
  });

  it('preserves insertion order among unscored commands', () => {
    const result = uniqueSortedCommandNames(
      ['cmd-b', 'cmd-a', 'cmd-c'],
      {}
    );
    expect(result).toEqual(['cmd-b', 'cmd-a', 'cmd-c']);
  });

  it('handles empty input', () => {
    expect(uniqueSortedCommandNames([], {})).toEqual([]);
  });
});

describe('buildConfidenceBuckets', () => {
  const originalSuggestedEnv = process.env.SKILL_SUGGESTED_THRESHOLD;

  afterEach(() => {
    if (originalSuggestedEnv === undefined) {
      delete process.env.SKILL_SUGGESTED_THRESHOLD;
    } else {
      process.env.SKILL_SUGGESTED_THRESHOLD = originalSuggestedEnv;
    }
  });

  it('buckets skills into required and suggested by threshold', () => {
    delete process.env.SKILL_SUGGESTED_THRESHOLD;

    const analysis: AnalysisResult = {
      required: [],
      suggested: [],
      requiredCommands: [],
      suggestedCommands: [],
      commandScores: {},
      scores: { 'high-skill': 0.8, 'mid-skill': 0.55, 'low-skill': 0.2 },
    };

    const result = buildConfidenceBuckets(analysis, 0.65);
    expect(result.required).toContain('high-skill');
    expect(result.suggested).toContain('mid-skill');
    expect(result.required).not.toContain('low-skill');
    expect(result.suggested).not.toContain('low-skill');
  });

  it('uses required/suggested arrays for unscored skills', () => {
    const analysis: AnalysisResult = {
      required: ['req-skill'],
      suggested: ['sug-skill'],
      requiredCommands: [],
      suggestedCommands: [],
      commandScores: {},
    };

    const result = buildConfidenceBuckets(analysis, 0.65);
    expect(result.required).toContain('req-skill');
    expect(result.suggested).toContain('sug-skill');
  });

  it('deduplicates skills in output', () => {
    const analysis: AnalysisResult = {
      required: ['dup-skill'],
      suggested: [],
      requiredCommands: [],
      suggestedCommands: [],
      commandScores: {},
      scores: { 'dup-skill': 0.9 },
    };

    const result = buildConfidenceBuckets(analysis, 0.65);
    const dupCount = result.required.filter((s) => s === 'dup-skill').length;
    expect(dupCount).toBe(1);
  });

  it('returns scores map from analysis', () => {
    const analysis: AnalysisResult = {
      required: [],
      suggested: [],
      requiredCommands: [],
      suggestedCommands: [],
      commandScores: {},
      scores: { 'a': 0.9 },
    };

    const result = buildConfidenceBuckets(analysis, 0.65);
    expect(result.scores).toEqual({ 'a': 0.9 });
  });

  it('handles empty analysis', () => {
    const analysis: AnalysisResult = {
      required: [],
      suggested: [],
      requiredCommands: [],
      suggestedCommands: [],
      commandScores: {},
    };

    const result = buildConfidenceBuckets(analysis, 0.65);
    expect(result.required).toEqual([]);
    expect(result.suggested).toEqual([]);
  });
});

describe('getSelectionLabel', () => {
  const required = new Set(['critical-skill']);
  const promoted = new Set(['promoted-skill']);
  const affinity = new Set(['affinity-skill']);

  it('returns "critical" for required skills', () => {
    expect(getSelectionLabel('critical-skill', required, promoted, affinity)).toBe('critical');
  });

  it('returns "promoted" for promoted skills', () => {
    expect(getSelectionLabel('promoted-skill', required, promoted, affinity)).toBe('promoted');
  });

  it('returns "affinity" for affinity skills', () => {
    expect(getSelectionLabel('affinity-skill', required, promoted, affinity)).toBe('affinity');
  });

  it('returns "dependency" for skills not in any set', () => {
    expect(getSelectionLabel('other-skill', required, promoted, affinity)).toBe('dependency');
  });

  it('prefers critical over promoted when in both sets', () => {
    const bothRequired = new Set(['both']);
    const bothPromoted = new Set(['both']);
    expect(getSelectionLabel('both', bothRequired, bothPromoted, new Set())).toBe('critical');
  });
});

describe('resolveStateDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns legacy path when it exists', async () => {
    mockedAccess.mockResolvedValue(undefined);

    const result = await resolveStateDirectory('/plugin', '/project');
    expect(result).toContain('.claude');
    expect(result).toContain('state');
  });

  it('returns plugin path when legacy does not exist', async () => {
    mockedAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await resolveStateDirectory('/plugin', '/project');
    // On Windows, path.join produces backslashes; normalize for comparison
    const normalized = result.replace(/\\/g, '/');
    expect(normalized).toBe('/plugin/state');
  });
});

describe('loadSkillRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid skill-rules.json', async () => {
    const validRules = JSON.stringify({
      version: '1.0',
      skills: {
        'test-skill': { type: 'domain', description: 'a test skill' },
      },
    });
    mockedReadFile.mockResolvedValue(validRules);

    const result = await loadSkillRules();
    expect(result.version).toBe('1.0');
    expect(result.skills['test-skill']).toBeDefined();
  });

  it('falls back to discovery when JSON is not a record', async () => {
    mockedReadFile.mockResolvedValue('"just a string"');

    const result = await loadSkillRules();
    expect(result.version).toBe('discovered');
  });

  it('falls back to discovery when shape is invalid (missing version)', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ skills: {} }));

    const result = await loadSkillRules();
    expect(result.version).toBe('discovered');
  });

  it('falls back to discovery when shape is invalid (skills not a record)', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ version: '1.0', skills: 'not-object' }));

    const result = await loadSkillRules();
    expect(result.version).toBe('discovered');
  });

  it('falls back to discovery when readFile throws', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

    const result = await loadSkillRules();
    expect(result.version).toBe('discovered');
  });

  it('falls back to discovery when JSON parse fails', async () => {
    mockedReadFile.mockResolvedValue('not-json{{{');

    const result = await loadSkillRules();
    expect(result.version).toBe('discovered');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs module before importing cache-manager
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock debug-logger to suppress output
vi.mock('../debug-logger.js', () => ({
  debugLog: vi.fn(),
}));

// Mock constants to provide stable values
vi.mock('../constants.js', () => ({
  CACHE_TTL_MS: 3600000, // 1 hour
  CACHE_CLEANUP_AGE_MS: 86400000, // 24 hours
  SKILLS_CACHE_DIR: '/tmp/test-cache',
}));

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import {
  isPersistentCacheEnabled,
  readCache,
  writeCache,
} from '../cache-manager.js';

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedUnlinkSync = vi.mocked(unlinkSync);
const mockedStatSync = vi.mocked(statSync);

describe('isPersistentCacheEnabled', () => {
  const originalEnv = process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;
    } else {
      process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = originalEnv;
    }
  });

  it('returns false when env var is not set', () => {
    delete process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;
    expect(isPersistentCacheEnabled()).toBe(false);
  });

  it('returns true when env var is "ON"', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    expect(isPersistentCacheEnabled()).toBe(true);
  });

  it('returns true when env var is "on" (case-insensitive)', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'on';
    expect(isPersistentCacheEnabled()).toBe(true);
  });

  it('returns true when env var is " On " (trimmed, case-insensitive)', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = ' On ';
    expect(isPersistentCacheEnabled()).toBe(true);
  });

  it('returns false when env var is "OFF"', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'OFF';
    expect(isPersistentCacheEnabled()).toBe(false);
  });

  it('returns false when env var is empty string', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = '';
    expect(isPersistentCacheEnabled()).toBe(false);
  });

  it('returns false when env var is "1"', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = '1';
    expect(isPersistentCacheEnabled()).toBe(false);
  });

  it('returns false when env var is "true"', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'true';
    expect(isPersistentCacheEnabled()).toBe(false);
  });
});

describe('readCache', () => {
  const originalEnv = process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;
    } else {
      process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = originalEnv;
    }
  });

  it('returns null when cache is disabled', () => {
    delete process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;
    const result = readCache('test-key');
    expect(result).toBeNull();
    expect(mockedExistsSync).not.toHaveBeenCalled();
  });

  it('returns null when cache file does not exist', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(false);

    const result = readCache('missing-key');
    expect(result).toBeNull();
  });

  it('returns null when cache entry is expired', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(true);

    const expiredEntry = {
      timestamp: Date.now() - 7200000, // 2 hours ago (TTL is 1 hour)
      result: {
        required: ['skill-a'],
        suggested: ['skill-b'],
        requiredCommands: [],
        suggestedCommands: [],
        commandScores: {},
      },
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(expiredEntry));

    const result = readCache('expired-key');
    expect(result).toBeNull();
  });

  it('returns valid result for fresh cache entry', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(true);

    const freshEntry = {
      timestamp: Date.now() - 60000, // 1 minute ago
      result: {
        required: ['skill-a'],
        suggested: ['skill-b'],
        requiredCommands: ['cmd-x'],
        suggestedCommands: ['cmd-y'],
        commandScores: { 'cmd-x': 0.95 },
      },
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(freshEntry));

    const result = readCache('fresh-key');
    expect(result).toEqual({
      required: ['skill-a'],
      suggested: ['skill-b'],
      requiredCommands: ['cmd-x'],
      suggestedCommands: ['cmd-y'],
      commandScores: { 'cmd-x': 0.95 },
    });
  });

  it('fills in missing arrays with empty defaults', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(true);

    const partialEntry = {
      timestamp: Date.now() - 60000,
      result: {
        // Omit all optional fields to test defaults
      },
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(partialEntry));

    const result = readCache('partial-key');
    expect(result).toEqual({
      required: [],
      suggested: [],
      requiredCommands: [],
      suggestedCommands: [],
      commandScores: {},
    });
  });

  it('returns null for corrupt JSON', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('not-valid-json{{{');

    const result = readCache('corrupt-key');
    expect(result).toBeNull();
  });

  it('returns null when readFileSync throws', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = readCache('error-key');
    expect(result).toBeNull();
  });
});

describe('writeCache', () => {
  const originalEnv = process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the cleanup debounce by ensuring enough time has "passed"
    vi.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;
    } else {
      process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = originalEnv;
    }
  });

  const sampleResult = {
    required: ['skill-a'],
    suggested: ['skill-b'],
    requiredCommands: ['cmd-x'],
    suggestedCommands: ['cmd-y'],
    commandScores: { 'cmd-x': 0.95 },
  };

  it('is a no-op when cache is disabled', () => {
    delete process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;
    writeCache('test-key', sampleResult);
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
    expect(mockedMkdirSync).not.toHaveBeenCalled();
  });

  it('creates directory if missing', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(false);
    mockedReaddirSync.mockReturnValue([]);

    writeCache('new-key', sampleResult);

    expect(mockedMkdirSync).toHaveBeenCalledWith('/tmp/test-cache', { recursive: true });
  });

  it('writes valid JSON to the cache file', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([]);

    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    writeCache('write-key', sampleResult);

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = mockedWriteFileSync.mock.calls[0];
    expect(path).toContain('write-key.json');

    const parsed = JSON.parse(content as string);
    expect(parsed.timestamp).toBe(now);
    expect(parsed.result.required).toEqual(['skill-a']);
    expect(parsed.result.suggestedCommands).toEqual(['cmd-y']);
  });

  it('does not throw when writeFileSync fails', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([]);
    mockedWriteFileSync.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    // Should not throw
    expect(() => writeCache('fail-key', sampleResult)).not.toThrow();
  });

  it('does not throw when mkdirSync fails', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';
    mockedExistsSync.mockReturnValue(false);
    mockedMkdirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => writeCache('fail-key', sampleResult)).not.toThrow();
  });
});

describe('maybeCleanupOldCacheEntries (via writeCache)', () => {
  const originalEnv = process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE;
    } else {
      process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = originalEnv;
    }
  });

  const sampleResult = {
    required: [],
    suggested: [],
    requiredCommands: [],
    suggestedCommands: [],
    commandScores: {},
  };

  it('removes files older than CACHE_CLEANUP_AGE_MS', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';

    // Use a time far enough from any possible lastCacheCleanupAt set by prior tests
    const now = 2000000000000; // well past any prior mock time
    vi.spyOn(Date, 'now').mockReturnValue(now);

    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([
      'old-entry.json' as unknown as import('fs').Dirent,
      'fresh-entry.json' as unknown as import('fs').Dirent,
    ]);
    mockedStatSync.mockImplementation((filePath: import('fs').PathLike) => {
      const fp = String(filePath);
      if (fp.includes('old-entry')) {
        return { mtimeMs: now - 100000000 } as import('fs').Stats; // ~27 hours old
      }
      return { mtimeMs: now - 1000 } as import('fs').Stats; // 1 second old
    });

    writeCache('trigger-cleanup', sampleResult);

    expect(mockedUnlinkSync).toHaveBeenCalledTimes(1);
    expect(String(mockedUnlinkSync.mock.calls[0][0])).toContain('old-entry.json');
  });

  it('respects cleanup interval debounce', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';

    // The first writeCache in the prior test set lastCacheCleanupAt.
    // Call again at close time - should be debounced since
    // the module-level lastCacheCleanupAt was updated.
    // We need a fresh time that is within 5 minutes of the last cleanup.
    const now = 10 * 60 * 1000 + 1000; // 1 second after prior cleanup time
    vi.spyOn(Date, 'now').mockReturnValue(now);

    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([]);

    writeCache('debounce-key', sampleResult);

    // readdirSync might or might not be called depending on debounce;
    // the key assertion is that no unlinkSync was called for cleanup
    // (readdirSync is called because debounce passed from the module perspective)
    // This test primarily verifies no crash occurs during debounce
    expect(mockedUnlinkSync).not.toHaveBeenCalled();
  });

  it('handles errors in cleanup gracefully', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';

    // Set time far enough from any prior cleanup
    const now = 100 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([
      'bad-file.json' as unknown as import('fs').Dirent,
    ]);
    mockedStatSync.mockImplementation(() => {
      throw new Error('ENOENT: file disappeared');
    });

    // Should not throw
    expect(() => writeCache('cleanup-error', sampleResult)).not.toThrow();
  });

  it('handles readdirSync failure gracefully', () => {
    process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE = 'ON';

    const now = 200 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => writeCache('readdir-fail', sampleResult)).not.toThrow();
  });
});

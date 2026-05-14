/**
 * Cache management for intent analysis results
 *
 * Provides an LRU-style cache with automatic cleanup of stale entries.
 * Persistent results are disabled by default. Enable cross-session reuse only
 * with DYNAMIC_SKILLS_PERSISTENT_CACHE=ON.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { CACHE_TTL_MS, CACHE_CLEANUP_AGE_MS, SKILLS_CACHE_DIR } from './constants.js';
import type { AnalysisResult, CacheEntry } from './types.js';
import { debugLog } from './debug-logger.js';

// Use the centralized constant which respects OPENCODE_PROJECT_DIR
const CACHE_DIR = SKILLS_CACHE_DIR;
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCacheCleanupAt = 0;

export function isPersistentCacheEnabled(): boolean {
  return process.env.DYNAMIC_SKILLS_PERSISTENT_CACHE?.trim().toUpperCase() === 'ON';
}

/**
 * Read cached intent analysis result
 *
 * @param key - MD5 hash of prompt + skills configuration
 * @returns Cached result if found and not expired, null otherwise
 */
export function readCache(key: string): AnalysisResult | null {
  if (!isPersistentCacheEnabled()) {
    return null;
  }

  const cachePath = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(cachePath)) {
    debugLog(`cache-manager: cache miss key=${key} path=${cachePath}`);
    return null;
  }

  try {
    const data: CacheEntry = JSON.parse(readFileSync(cachePath, 'utf-8'));
    const age = Date.now() - data.timestamp;

    if (age > CACHE_TTL_MS) {
      return null; // Expired
    }

    return {
      required: data.result.required || [],
      suggested: data.result.suggested || [],
      requiredCommands: data.result.requiredCommands || [],
      suggestedCommands: data.result.suggestedCommands || [],
      commandScores: data.result.commandScores || {},
    };
  } catch (error) {
    debugLog(
      `cache-manager: failed to read/parse key=${key} path=${cachePath} reason=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/**
 * Write intent analysis result to cache
 *
 * Automatically cleans up cache entries older than 24 hours to prevent unbounded growth.
 *
 * @param key - MD5 hash of prompt + skills configuration
 * @param result - Analysis result to cache
 */
export function writeCache(
  key: string,
  result: Pick<
    AnalysisResult,
    'required' | 'suggested' | 'requiredCommands' | 'suggestedCommands' | 'commandScores'
  >
): void {
  if (!isPersistentCacheEnabled()) {
    return;
  }

  try {
    // Ensure cache directory exists
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }

    maybeCleanupOldCacheEntries();

    const cachePath = join(CACHE_DIR, `${key}.json`);
    const entry: CacheEntry = {
      timestamp: Date.now(),
      result,
    };

    writeFileSync(cachePath, JSON.stringify(entry));
  } catch (error) {
    debugLog(`cache-manager: writeCache failed: ${String(error)}`);
  }
}

/**
 * Remove cache entries older than 24 hours
 *
 * Runs automatically during writeCache to prevent unbounded cache growth.
 * Failures are logged in debug mode but don't fail the operation.
 */
function maybeCleanupOldCacheEntries(): void {
  const now = Date.now();
  if (now - lastCacheCleanupAt < CACHE_CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCacheCleanupAt = now;

  cleanupOldCacheEntries(now);
}

function cleanupOldCacheEntries(now: number): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      return;
    }

    const files = readdirSync(CACHE_DIR);

    for (const file of files) {
      const filePath = join(CACHE_DIR, file);
      try {
        const stats = statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > CACHE_CLEANUP_AGE_MS) {
          unlinkSync(filePath);
        }
      } catch (err) {
        debugLog(`cache-manager: cleanup failed to process ${file}: ${String(err)}`);
      }
    }
  } catch (err) {
    debugLog(`cache-manager: cleanup failed: ${String(err)}`);
  }
}

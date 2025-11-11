/**
 * Cache management for intent analysis results
 *
 * Provides an LRU-style cache with automatic cleanup of stale entries.
 * Results are cached based on prompt + skills hash to invalidate when
 * skill definitions change.
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
import { CACHE_TTL_MS, CACHE_CLEANUP_AGE_MS } from './constants.js';
import type { CacheEntry } from './types.js';

// Use project root for cache directory, not hooks cwd
const CACHE_DIR = join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  '.cache',
  'intent-analysis'
);

/**
 * Read cached intent analysis result
 *
 * @param key - MD5 hash of prompt + skills configuration
 * @returns Cached result if found and not expired, null otherwise
 */
export function readCache(key: string): { required: string[]; suggested: string[] } | null {
  const cachePath = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const data: CacheEntry = JSON.parse(readFileSync(cachePath, 'utf-8'));
    const age = Date.now() - data.timestamp;

    if (age > CACHE_TTL_MS) {
      return null; // Expired
    }

    return data.result;
  } catch {
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
export function writeCache(key: string, result: { required: string[]; suggested: string[] }): void {
  // Ensure cache directory exists
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  // Cleanup old cache entries (>24 hours)
  cleanupOldCacheEntries();

  const cachePath = join(CACHE_DIR, `${key}.json`);
  const entry: CacheEntry = {
    timestamp: Date.now(),
    result,
  };

  writeFileSync(cachePath, JSON.stringify(entry));
}

/**
 * Remove cache entries older than 24 hours
 *
 * Runs automatically during writeCache to prevent unbounded cache growth.
 * Failures are logged in debug mode but don't fail the operation.
 */
function cleanupOldCacheEntries(): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      return;
    }

    const files = readdirSync(CACHE_DIR);
    const now = Date.now();

    files.forEach((file) => {
      const filePath = join(CACHE_DIR, file);
      try {
        const stats = statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > CACHE_CLEANUP_AGE_MS) {
          unlinkSync(filePath);
        }
      } catch (err) {
        // Log in debug mode for troubleshooting
        if (process.env.CLAUDE_SKILL_DEBUG === 'true') {
          console.warn(`Cache cleanup: failed to process ${file}:`, err);
        }
      }
    });
  } catch (err) {
    // Log directory-level errors in debug mode
    if (process.env.CLAUDE_SKILL_DEBUG === 'true') {
      console.warn('Cache cleanup failed:', err);
    }
  }
}

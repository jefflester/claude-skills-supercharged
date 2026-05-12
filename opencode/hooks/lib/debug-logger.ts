/**
 * Debug logging for skill injection system
 *
 * Conditional logging controlled by OPENCODE_SKILLS_DEBUG environment variable.
 * Provides detailed trace of skill injection pipeline for troubleshooting.
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { DEBUG_ENABLED } from './constants.js';

const DEBUG_SKILLS = DEBUG_ENABLED;
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Log debug message to skill injection debug log
 *
 * Only logs when OPENCODE_SKILLS_DEBUG=1 environment variable is set.
 * Automatically rotates log file when it exceeds 10MB.
 * Never throws - logging failures are caught and logged to stderr.
 *
 * @param message - Message to log
 */
export function debugLog(message: string): void {
  if (!DEBUG_SKILLS) return;

  try {
    const logDirectory = join(
      process.env.OPENCODE_PROJECT_DIR || process.cwd(),
      '.opencode',
      'hooks'
    );
    const logPath = join(logDirectory, 'skill-injection-debug.log');

    mkdirSync(logDirectory, { recursive: true });

    // Rotate log if too large
    if (existsSync(logPath)) {
      const stats = statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        renameSync(logPath, `${logPath}.old`);
      }
    }

    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (err) {
    // Silently fail - logging must never break the hook
    console.error('⚠️ Debug logging failed:', err);
  }
}

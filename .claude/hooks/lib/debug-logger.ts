/**
 * Debug logging for skill injection system
 *
 * Conditional logging controlled by CLAUDE_SKILLS_DEBUG environment variable.
 * Provides detailed trace of skill injection pipeline for troubleshooting.
 */

import { appendFileSync, existsSync, statSync, renameSync } from 'fs';
import { join } from 'path';

const DEBUG_SKILLS = process.env.CLAUDE_SKILLS_DEBUG === '1';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Log debug message to skill injection debug log
 *
 * Only logs when CLAUDE_SKILLS_DEBUG=1 environment variable is set.
 * Automatically rotates log file when it exceeds 10MB.
 * Never throws - logging failures are caught and logged to stderr.
 *
 * @param message - Message to log
 */
export function debugLog(message: string): void {
  if (!DEBUG_SKILLS) return;

  try {
    const logPath = join(
      process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      '.claude',
      'hooks',
      'skill-injection-debug.log'
    );

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

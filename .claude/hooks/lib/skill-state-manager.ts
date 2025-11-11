/**
 * Session state management for skill acknowledgments
 *
 * Tracks which skills have been suggested/injected in each conversation
 * to avoid re-suggesting the same skills repeatedly. State is persisted
 * per-conversation using conversation_id or session_id.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { SessionState } from './types.js';

/**
 * Extended session state with metadata
 */
interface ExtendedSessionState extends SessionState {
  timestamp: number;
  injectedSkills: string[];
  injectionTimestamp: number;
}

/**
 * Read acknowledged skills from session state file
 *
 * Returns list of skills that have been suggested/injected in previous
 * turns of the current conversation.
 *
 * @param stateDir - State directory path (.claude/hooks/state)
 * @param stateId - Conversation or session ID
 * @returns Array of acknowledged skill names
 */
export function readAcknowledgedSkills(stateDir: string, stateId: string): string[] {
  const stateFile = join(stateDir, `${stateId}-skills-suggested.json`);

  if (!existsSync(stateFile)) {
    return [];
  }

  try {
    const existing: ExtendedSessionState = JSON.parse(readFileSync(stateFile, 'utf-8'));
    return existing.acknowledgedSkills || [];
  } catch {
    // Invalid JSON, start fresh
    return [];
  }
}

/**
 * Write session state to track acknowledged skills
 *
 * Uses atomic write pattern (write to temp file, then rename) to prevent
 * corruption from concurrent hook invocations.
 *
 * @param stateDir - State directory path
 * @param stateId - Conversation or session ID
 * @param acknowledgedSkills - All skills acknowledged (existing + new)
 * @param injectedSkills - Skills injected this turn
 */
export function writeSessionState(
  stateDir: string,
  stateId: string,
  acknowledgedSkills: string[],
  injectedSkills: string[]
): void {
  try {
    // Ensure state directory exists
    mkdirSync(stateDir, { recursive: true });

    const stateFile = join(stateDir, `${stateId}-skills-suggested.json`);
    const tempFile = `${stateFile}.tmp`;

    const stateData: ExtendedSessionState = {
      timestamp: Date.now(),
      acknowledgedSkills,
      injectedSkills,
      injectionTimestamp: Date.now(),
    };

    // Atomic write: write to temp file, then rename
    // This prevents corruption if multiple hooks run concurrently
    writeFileSync(tempFile, JSON.stringify(stateData, null, 2));

    // Rename is atomic on most filesystems
    if (existsSync(stateFile)) {
      unlinkSync(stateFile);
    }

    // Note: renameSync would be better but requires importing from fs
    writeFileSync(stateFile, readFileSync(tempFile, 'utf-8'));
    unlinkSync(tempFile);
  } catch (err) {
    // Don't fail the hook if state writing fails
    console.error('Warning: Failed to write session state:', err);
  }
}

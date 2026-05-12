/**
 * Session state management for skill acknowledgments
 *
 * Tracks which skills have been suggested/injected in each conversation
 * to avoid re-suggesting the same skills repeatedly. State is persisted
 * per-conversation using conversation_id or session_id.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { SessionState } from './types.js';
import { debugLog } from './debug-logger.js';

/**
 * Extended session state with metadata
 */
interface ExtendedSessionState extends SessionState {
  timestamp: number;
  injectedSkills: string[];
  acknowledgedCommands?: string[];
  injectedCommands?: string[];
  injectionTimestamp: number;
}

interface AcknowledgedState {
  acknowledgedSkills: string[];
  acknowledgedCommands: string[];
}

function sanitizeStateId(stateId: string): string {
  return stateId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function hashStateId(stateId: string): string {
  return createHash('sha256').update(stateId).digest('hex').slice(0, 16);
}

export function getSessionStateFilename(stateId: string): string {
  return `${sanitizeStateId(stateId)}-${hashStateId(stateId)}-skills-suggested.json`;
}

export function getSessionStatePath(stateDir: string, stateId: string): string {
  return join(stateDir, getSessionStateFilename(stateId));
}

function getLegacySessionStatePath(stateDir: string, stateId: string): string {
  return join(stateDir, `${stateId}-skills-suggested.json`);
}

function isSafeLegacyStateId(stateId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(stateId);
}

export function getSafeLegacySessionStatePath(
  stateDir: string,
  stateId: string
): string | null {
  if (!isSafeLegacyStateId(stateId)) {
    return null;
  }

  return getLegacySessionStatePath(stateDir, stateId);
}

function resolveStateFilePath(stateDir: string, stateId: string): string {
  const stateFile = getSessionStatePath(stateDir, stateId);
  if (existsSync(stateFile)) {
    return stateFile;
  }

  if (isSafeLegacyStateId(stateId)) {
    return getLegacySessionStatePath(stateDir, stateId);
  }

  return stateFile;
}

function readSessionState(stateDir: string, stateId: string): ExtendedSessionState | null {
  const targetFile = resolveStateFilePath(stateDir, stateId);
  if (!existsSync(targetFile)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(targetFile, 'utf-8')) as ExtendedSessionState;
  } catch (error) {
    debugLog(
      `skill-state-manager: failed to parse session state ${targetFile}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    debugLog(`skill-state-manager: invalid state field ${fieldName}, expected array`);
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

export function readAcknowledgedState(stateDir: string, stateId: string): AcknowledgedState {
  const state = readSessionState(stateDir, stateId);
  if (!state) {
    return { acknowledgedSkills: [], acknowledgedCommands: [] };
  }

  return {
    acknowledgedSkills: normalizeStringArray(state.acknowledgedSkills, 'acknowledgedSkills'),
    acknowledgedCommands: normalizeStringArray(
      state.acknowledgedCommands,
      'acknowledgedCommands'
    ),
  };
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
  return readAcknowledgedState(stateDir, stateId).acknowledgedSkills;
}

/**
 * Read acknowledged commands from session state file
 */
export function readAcknowledgedCommands(stateDir: string, stateId: string): string[] {
  return readAcknowledgedState(stateDir, stateId).acknowledgedCommands;
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
  injectedSkills: string[],
  acknowledgedCommands: string[] = [],
  injectedCommands: string[] = []
): void {
  try {
    // Ensure state directory exists
    mkdirSync(stateDir, { recursive: true });

    const stateFile = getSessionStatePath(stateDir, stateId);
    const tempFile = `${stateFile}.tmp`;

    const stateData: ExtendedSessionState = {
      timestamp: Date.now(),
      acknowledgedSkills,
      injectedSkills,
      acknowledgedCommands,
      injectedCommands,
      injectionTimestamp: Date.now(),
    };

    // Atomic write: write to temp file, then rename
    // This prevents corruption if multiple hooks run concurrently
    writeFileSync(tempFile, JSON.stringify(stateData, null, 2));

    // renameSync is atomic on POSIX systems - overwrites existing file atomically.
    // On Windows, renameSync fails if the target exists, so fall back to
    // unlinkSync + renameSync.
    try {
      renameSync(tempFile, stateFile);
    } catch {
      unlinkSync(stateFile);
      renameSync(tempFile, stateFile);
    }
  } catch (err) {
    // Don't fail the hook if state writing fails
    debugLog(
      `skill-state-manager: failed to write session state for ${stateId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, chmodSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readAcknowledgedSkills, writeSessionState } from '../skill-state-manager.js';

/**
 * Tests for session state management
 *
 * Validates state persistence, atomic writes, and error handling
 * for skill acknowledgment tracking across conversation turns.
 */

describe('Skill State Manager', () => {
  let testStateDir: string;
  let testStateId: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    testStateDir = join(tmpdir(), `skill-state-test-${Date.now()}-${Math.random()}`);
    testStateId = 'test-conversation-123';
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testStateDir)) {
      try {
        chmodSync(testStateDir, 0o755); // Restore permissions if changed
        rmSync(testStateDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('should write and read state successfully (normal flow)', () => {
    const acknowledgedSkills = ['frontend-framework', 'testing-strategy'];
    const injectedSkills = ['frontend-framework'];

    writeSessionState(testStateDir, testStateId, acknowledgedSkills, injectedSkills);

    const readSkills = readAcknowledgedSkills(testStateDir, testStateId);

    expect(readSkills).toEqual(acknowledgedSkills);
  });

  it('should return empty array when state file does not exist', () => {
    // Don't create any state file
    const readSkills = readAcknowledgedSkills(testStateDir, testStateId);

    expect(readSkills).toEqual([]);
  });

  it('should return empty array when state file contains corrupted JSON', () => {
    // Create directory and write invalid JSON
    mkdirSync(testStateDir, { recursive: true });
    const stateFile = join(testStateDir, `${testStateId}-skills-suggested.json`);
    writeFileSync(stateFile, '{ this is not valid JSON }');

    const readSkills = readAcknowledgedSkills(testStateDir, testStateId);

    expect(readSkills).toEqual([]);
  });

  it('should use atomic write pattern (temp file + rename)', () => {
    const acknowledgedSkills = ['skill-1', 'skill-2'];
    const injectedSkills = ['skill-1'];

    writeSessionState(testStateDir, testStateId, acknowledgedSkills, injectedSkills);

    const stateFile = join(testStateDir, `${testStateId}-skills-suggested.json`);
    const tempFile = `${stateFile}.tmp`;

    // After write completes:
    // 1. Main state file should exist
    expect(existsSync(stateFile)).toBe(true);

    // 2. Temp file should be cleaned up
    expect(existsSync(tempFile)).toBe(false);
  });

  it('should handle permission errors gracefully (no crash)', () => {
    // Create read-only directory to trigger permission error
    mkdirSync(testStateDir, { recursive: true });

    // Make directory read-only (this will prevent file creation)
    try {
      chmodSync(testStateDir, 0o444);
    } catch {
      // If chmod fails (e.g., on some CI systems), skip test
      return;
    }

    const acknowledgedSkills = ['test-skill'];
    const injectedSkills = ['test-skill'];

    // Should not throw - just log warning
    expect(() => {
      writeSessionState(testStateDir, testStateId, acknowledgedSkills, injectedSkills);
    }).not.toThrow();

    // Restore permissions for cleanup
    chmodSync(testStateDir, 0o755);
  });

  it('should create state directory if it does not exist', () => {
    // Ensure directory doesn't exist
    expect(existsSync(testStateDir)).toBe(false);

    const acknowledgedSkills = ['new-skill'];
    const injectedSkills = ['new-skill'];

    writeSessionState(testStateDir, testStateId, acknowledgedSkills, injectedSkills);

    // Directory should be created
    expect(existsSync(testStateDir)).toBe(true);

    // State should be readable
    const readSkills = readAcknowledgedSkills(testStateDir, testStateId);
    expect(readSkills).toEqual(acknowledgedSkills);
  });

  it('should preserve all state fields when updating', () => {
    const firstAcknowledged = ['skill-1'];
    const firstInjected = ['skill-1'];

    // First write
    writeSessionState(testStateDir, testStateId, firstAcknowledged, firstInjected);

    const stateFile = join(testStateDir, `${testStateId}-skills-suggested.json`);
    const firstState = JSON.parse(readFileSync(stateFile, 'utf-8'));

    // Verify all fields present
    expect(firstState).toHaveProperty('timestamp');
    expect(firstState).toHaveProperty('acknowledgedSkills');
    expect(firstState).toHaveProperty('injectedSkills');
    expect(firstState).toHaveProperty('injectionTimestamp');

    expect(firstState.acknowledgedSkills).toEqual(firstAcknowledged);
    expect(firstState.injectedSkills).toEqual(firstInjected);
  });

  it('should handle empty acknowledged skills array', () => {
    const acknowledgedSkills: string[] = [];
    const injectedSkills: string[] = [];

    writeSessionState(testStateDir, testStateId, acknowledgedSkills, injectedSkills);

    const readSkills = readAcknowledgedSkills(testStateDir, testStateId);

    expect(readSkills).toEqual([]);
  });

  it('should handle updates to existing state file', () => {
    // First write
    writeSessionState(testStateDir, testStateId, ['skill-1'], ['skill-1']);

    let readSkills = readAcknowledgedSkills(testStateDir, testStateId);
    expect(readSkills).toEqual(['skill-1']);

    // Second write (update)
    writeSessionState(testStateDir, testStateId, ['skill-1', 'skill-2'], ['skill-2']);

    readSkills = readAcknowledgedSkills(testStateDir, testStateId);
    expect(readSkills).toEqual(['skill-1', 'skill-2']);
  });

  it('should return empty array when state file has malformed structure', () => {
    // Create state file with valid JSON but missing acknowledgedSkills field
    mkdirSync(testStateDir, { recursive: true });
    const stateFile = join(testStateDir, `${testStateId}-skills-suggested.json`);
    writeFileSync(
      stateFile,
      JSON.stringify({
        timestamp: Date.now(),
        // Missing acknowledgedSkills field
        injectedSkills: ['skill-1'],
      })
    );

    const readSkills = readAcknowledgedSkills(testStateDir, testStateId);

    // Should return empty array when acknowledgedSkills is missing
    expect(readSkills).toEqual([]);
  });
});

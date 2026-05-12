import { existsSync, mkdtempSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  getSessionStatePath,
  readAcknowledgedCommands,
  readAcknowledgedSkills,
  writeSessionState,
} from '../skill-state-manager.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'command-state-'));
}

describe('command session state', () => {
  it('reads old skill-only state as empty acknowledged commands', async () => {
    const stateDir = makeTempDir();
    await writeFile(
      join(stateDir, 'session-1-skills-suggested.json'),
      JSON.stringify({ acknowledgedSkills: ['tdd-workflow'] })
    );

    expect(readAcknowledgedSkills(stateDir, 'session-1')).toEqual(['tdd-workflow']);
    expect(readAcknowledgedCommands(stateDir, 'session-1')).toEqual([]);
  });

  it('writes acknowledged commands while preserving acknowledged skills', async () => {
    const stateDir = makeTempDir();

    writeSessionState(
      stateDir,
      'session-2',
      ['tdd-workflow'],
      ['tdd-workflow'],
      ['quality-gate'],
      ['quality-gate']
    );

    const rawState = await readFile(getSessionStatePath(stateDir, 'session-2'), 'utf-8');
    const state = JSON.parse(rawState);

    expect(state.acknowledgedSkills).toEqual(['tdd-workflow']);
    expect(state.injectedSkills).toEqual(['tdd-workflow']);
    expect(state.acknowledgedCommands).toEqual(['quality-gate']);
    expect(state.injectedCommands).toEqual(['quality-gate']);
  });

  it('does not read unsafe legacy paths built from raw session ids', async () => {
    const stateDir = makeTempDir();
    const outsideFile = join(stateDir, '..', 'outside-skills-suggested.json');
    await writeFile(
      outsideFile,
      JSON.stringify({
        acknowledgedSkills: ['outside-skill'],
        acknowledgedCommands: ['outside-command'],
      })
    );

    expect(readAcknowledgedSkills(stateDir, '..\\outside')).toEqual([]);
    expect(readAcknowledgedCommands(stateDir, '..\\outside')).toEqual([]);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('returns empty arrays for invalid acknowledged field shapes', async () => {
    const stateDir = makeTempDir();
    await writeFile(
      getSessionStatePath(stateDir, 'invalid-shapes'),
      JSON.stringify({
        acknowledgedSkills: 'bad',
        acknowledgedCommands: { bad: true },
      })
    );

    expect(readAcknowledgedSkills(stateDir, 'invalid-shapes')).toEqual([]);
    expect(readAcknowledgedCommands(stateDir, 'invalid-shapes')).toEqual([]);
  });
});

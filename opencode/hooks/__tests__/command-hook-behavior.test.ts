import { mkdtempSync } from 'fs';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStatePath } from '../lib/skill-state-manager.js';

const analyzeIntentMock = vi.fn();
const mocks = vi.hoisted(() => ({
  debugLog: vi.fn(),
  discoverCommands: vi.fn(),
}));

vi.mock('../lib/intent-analyzer.js', () => ({
  analyzeIntent: analyzeIntentMock,
}));

vi.mock('../lib/debug-logger.js', () => ({
  debugLog: mocks.debugLog,
}));

vi.mock('../lib/skill-discovery.js', () => ({
  SKILL_RULES_PATH: 'C:\\missing\\skill-rules.json',
  SKILLS_DIR: 'C:\\missing\\skills',
  buildSkillRulesFromSkills: () => ({
    version: '1.0-discovered',
    skills: {
      'verification-loop': {
        type: 'guardrail',
        description: 'Verify changes',
      },
    },
  }),
}));

vi.mock('../lib/command-discovery.js', () => ({
  discoverCommands: mocks.discoverCommands,
  resolveCommandDiscoveryOptions: () => ({
    configPath: 'C:\\mock\\opencode.json',
    commandsDirs: ['C:\\mock\\commands'],
  }),
}));

const discoveredCommands = {
    'quality-gate': {
      description: 'Run quality checks',
      workflowPhase: 'Code Review',
      summary: 'UNIQUE_SUMMARY_SHOULD_NOT_INJECT',
      template: 'Full body must not appear. !npm test @secret $ARGUMENTS',
      source: 'markdown',
      sourcePath: 'C:\\mock\\commands\\quality-gate.md',
    },
    'code-review': {
      description: 'Review code changes',
      workflowPhase: 'Code Review',
      summary: 'SECOND_UNIQUE_SUMMARY_SHOULD_NOT_INJECT',
      template: 'Review body must not appear.',
      source: 'markdown',
      sourcePath: 'C:\\mock\\commands\\code-review.md',
    },
  };

async function createHooks() {
  const { default: plugin } = await import('../index.js');
  const pluginDirectory = mkdtempSync(join(tmpdir(), 'command-hook-plugin-'));

  const hooks = await plugin({
    directory: pluginDirectory,
    client: {
      session: {
        messages: async () => ({
          data: [
            {
              role: 'user',
              parts: [{ type: 'text', text: 'Run the quality gate and review this change.' }],
            },
          ],
        }),
      },
    },
  });

  return { hooks, pluginDirectory };
}

describe('command hook behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    analyzeIntentMock.mockReset();
    mocks.debugLog.mockReset();
    mocks.discoverCommands.mockReset();
    mocks.discoverCommands.mockReturnValue(discoveredCommands);
    analyzeIntentMock.mockResolvedValue({
      required: [],
      suggested: [],
      requiredCommands: ['quality-gate'],
      suggestedCommands: ['code-review'],
      commandScores: {
        'quality-gate': 0.94,
        'code-review': 0.78,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injects command summary and command pointer references on first transform pass', async () => {
    const { hooks } = await createHooks();
    const output = { system: [] as string[] };

    await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 's1' } } } });
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's1', model: {} }, output);

    const joined = output.system.join('\n');
    expect(joined).toContain('[$quality-gate](C:\\mock\\commands\\quality-gate.md)');
    expect(joined).toContain('[$code-review](C:\\mock\\commands\\code-review.md)');
    expect(joined).toContain('REQUIRED COMMANDS');
    expect(joined).toContain('SUGGESTED COMMANDS');
  });

  it('logs the formatted injected reference blocks in debug output', async () => {
    analyzeIntentMock.mockResolvedValue({
      required: ['verification-loop'],
      suggested: [],
      requiredCommands: ['quality-gate'],
      suggestedCommands: ['code-review'],
      commandScores: {
        'quality-gate': 0.94,
        'code-review': 0.78,
      },
    });
    const { hooks } = await createHooks();
    const output = { system: [] as string[] };

    await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 's-debug' } } } });
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's-debug', model: {} }, output);

    const debugOutput = mocks.debugLog.mock.calls.map((call) => String(call[0])).join('\n');
    expect(debugOutput).toContain('system.transform reference summary session=s-debug');
    expect(debugOutput).toContain('[$quality-gate](C:\\mock\\commands\\quality-gate.md)');
    expect(debugOutput).toContain('[$code-review](C:\\mock\\commands\\code-review.md)');
    expect(debugOutput).toContain('system.transform skill reference block session=s-debug');
    expect(debugOutput).toContain('[$verification-loop]');
    expect(debugOutput).toContain('verification-loop\\SKILL.md');
    expect(debugOutput).not.toContain('<skill name="verification-loop">');
    expect(debugOutput).not.toContain('Full body must not appear');
  });

  it('writes acknowledged commands to session state when commands are injected', async () => {
    const { hooks, pluginDirectory } = await createHooks();
    const output = { system: [] as string[] };

    await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 's2' } } } });
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's2', model: {} }, output);

    const rawState = await readFile(getSessionStatePath(join(pluginDirectory, 'state'), 's2'), 'utf-8');
    const state = JSON.parse(rawState);
    expect(state.acknowledgedCommands).toEqual(['quality-gate']);
    expect(state.injectedCommands).toEqual(['quality-gate']);
  });

  it('does not reinject commands on a second transform call for the same session', async () => {
    const { hooks } = await createHooks();
    const firstOutput = { system: [] as string[] };
    const secondOutput = { system: [] as string[] };

    await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 's3' } } } });
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's3', model: {} }, firstOutput);
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's3', model: {} }, secondOutput);

    expect(firstOutput.system.join('\n')).toContain('[$quality-gate]');
    expect(secondOutput.system.join('\n')).not.toContain('[$quality-gate]');
  });

  it('reuses discovered commands across transform calls when command sources are unchanged', async () => {
    const { hooks } = await createHooks();
    const firstOutput = { system: [] as string[] };
    const secondOutput = { system: [] as string[] };

    await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 's-cache-1' } } } });
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's-cache-1', model: {} }, firstOutput);
    await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 's-cache-2' } } } });
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's-cache-2', model: {} }, secondOutput);

    expect(mocks.discoverCommands).toHaveBeenCalledTimes(1);
  });

  it('never emits command body or template text into output.system', async () => {
    const { hooks } = await createHooks();
    const output = { system: [] as string[] };

    await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 's4' } } } });
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's4', model: {} }, output);

    const joined = output.system.join('\n');
    expect(joined).not.toContain('Full body must not appear');
    expect(joined).not.toContain('UNIQUE_SUMMARY_SHOULD_NOT_INJECT');
    expect(joined).not.toContain('SECOND_UNIQUE_SUMMARY_SHOULD_NOT_INJECT');
    expect(joined).not.toContain('!npm test');
    expect(joined).not.toContain('@secret');
    expect(joined).not.toContain('$ARGUMENTS');
  });

  it('removes migrated safe legacy state file on session.deleted', async () => {
    const { hooks, pluginDirectory } = await createHooks();
    const stateDir = join(pluginDirectory, 'state');
    await mkdir(stateDir, { recursive: true });
    const legacyStatePath = join(stateDir, 'legacy-safe-skills-suggested.json');
    await writeFile(
      legacyStatePath,
      JSON.stringify({
        acknowledgedSkills: ['tdd-workflow'],
        acknowledgedCommands: ['quality-gate'],
      })
    );

    await hooks.event?.({
      event: { type: 'session.deleted', properties: { info: { id: 'legacy-safe' } } },
    });

    await expect(access(legacyStatePath)).rejects.toThrow();
  });
});

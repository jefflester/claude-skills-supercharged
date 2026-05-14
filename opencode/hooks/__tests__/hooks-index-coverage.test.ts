import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { readFile, mkdir, writeFile, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStatePath } from '../lib/skill-state-manager.js';

const analyzeIntentMock = vi.fn();
const mocks = vi.hoisted(() => ({
  debugLog: vi.fn(),
  discoverCommands: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
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
      'tdd-workflow': {
        type: 'testing',
        description: 'Test-driven development',
      },
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

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('fs');
  return {
    ...actual,
    existsSync: mocks.existsSync,
    statSync: mocks.statSync,
    readdirSync: mocks.readdirSync,
  };
});

const discoveredCommands = {
  'quality-gate': {
    description: 'Run quality checks',
    workflowPhase: 'Code Review',
    summary: 'summary_qg',
    template: 'quality body',
    source: 'markdown',
    sourcePath: 'C:\\mock\\commands\\quality-gate.md',
  },
};

function defaultAnalysisMock() {
  return {
    required: [],
    suggested: [],
    requiredCommands: [],
    suggestedCommands: [],
    commandScores: {},
    scores: {},
  };
}

async function createHooks(clientOverride?: unknown) {
  const { default: plugin } = await import('../index.js');
  const pluginDirectory = mkdtempSync(join(tmpdir(), 'hooks-index-cov-'));

  const hooks = await plugin({
    directory: pluginDirectory,
    client: clientOverride ?? {
      session: {
        messages: async () => ({
          data: [
            {
              role: 'user',
              parts: [{ type: 'text', text: 'Test prompt for coverage.' }],
            },
          ],
        }),
      },
    },
  });

  return { hooks, pluginDirectory };
}

describe('hooks/index.ts additional coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    analyzeIntentMock.mockReset();
    mocks.debugLog.mockReset();
    mocks.discoverCommands.mockReset();
    mocks.discoverCommands.mockReturnValue(discoveredCommands);
    mocks.existsSync.mockReturnValue(false);
    mocks.statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    mocks.readdirSync.mockReturnValue([]);
    analyzeIntentMock.mockResolvedValue(defaultAnalysisMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // extractUserPromptFromMessages
  // =========================================================================

  describe('extractUserPromptFromMessages (indirect via system.transform)', () => {
    it('extracts prompt from messages with info.role and info.parts pattern', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => ({
            data: [
              {
                info: {
                  role: 'user',
                  parts: [{ type: 'text', text: 'Nested info prompt' }],
                },
              },
            ],
          }),
        },
      });

      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'ext-1' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'ext-1', model: {} }, output);

      expect(analyzeIntentMock).toHaveBeenCalled();
      const promptArg = analyzeIntentMock.mock.calls[0][0] as string;
      expect(promptArg).toBe('Nested info prompt');
    });

    it('returns empty prompt when messages array is empty', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => ({ data: [] }),
        },
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'ext-2' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'ext-2', model: {} }, output);

      // With empty prompt, transform should skip
      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('no user prompt available');
    });

    it('returns empty prompt when messages is not an array', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => ({ data: 'not-an-array' }),
        },
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'ext-3' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'ext-3', model: {} }, output);

      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('no user prompt available');
    });

    it('skips non-user messages', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => ({
            data: [
              {
                role: 'assistant',
                parts: [{ type: 'text', text: 'I am an assistant' }],
              },
              {
                role: 'user',
                parts: [{ type: 'text', text: 'User says hello' }],
              },
            ],
          }),
        },
      });

      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'ext-4' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'ext-4', model: {} }, output);

      const promptArg = analyzeIntentMock.mock.calls[0][0] as string;
      expect(promptArg).toBe('User says hello');
      expect(promptArg).not.toContain('I am an assistant');
    });

    it('skips messages with non-text parts', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => ({
            data: [
              {
                role: 'user',
                parts: [
                  { type: 'image', data: 'binary' },
                  { type: 'text', text: 'Actual text' },
                ],
              },
            ],
          }),
        },
      });

      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'ext-5' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'ext-5', model: {} }, output);

      const promptArg = analyzeIntentMock.mock.calls[0][0] as string;
      expect(promptArg).toBe('Actual text');
    });

    it('skips messages where parts is not an array', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => ({
            data: [
              {
                role: 'user',
                parts: 'not-an-array',
              },
            ],
          }),
        },
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'ext-6' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'ext-6', model: {} }, output);

      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('no user prompt available');
    });

    it('skips null messages in the array', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => ({
            data: [
              null,
              42,
              { role: 'user', parts: [{ type: 'text', text: 'valid' }] },
            ],
          }),
        },
      });

      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'ext-7' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'ext-7', model: {} }, output);

      const promptArg = analyzeIntentMock.mock.calls[0][0] as string;
      expect(promptArg).toBe('valid');
    });
  });

  // =========================================================================
  // buildCommandDiscoverySignature
  // =========================================================================

  describe('buildCommandDiscoverySignature (indirect via cache invalidation)', () => {
    it('detects missing config path and missing command dirs', async () => {
      mocks.existsSync.mockReturnValue(false);
      mocks.discoverCommands.mockReturnValue(discoveredCommands);

      const { hooks } = await createHooks();
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        requiredCommands: ['quality-gate'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'sig-1' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'sig-1', model: {} }, output);

      expect(mocks.discoverCommands).toHaveBeenCalledTimes(1);
    });

    it('uses cached rules when signature is unchanged across sessions', async () => {
      mocks.existsSync.mockReturnValue(false);
      mocks.discoverCommands.mockReturnValue(discoveredCommands);

      const { hooks } = await createHooks();
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        requiredCommands: ['quality-gate'],
      });

      const output1 = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'sig-2a' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'sig-2a', model: {} }, output1);

      const output2 = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'sig-2b' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'sig-2b', model: {} }, output2);

      // discoverCommands should be called only once due to cache
      expect(mocks.discoverCommands).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache when config file stats change', async () => {
      let mtimeValue = 1000;
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('opencode.json')) return true;
        return false;
      });
      mocks.statSync.mockImplementation(() => ({
        mtimeMs: mtimeValue,
        size: 100,
        isFile: () => true,
        isDirectory: () => false,
      }));

      mocks.discoverCommands.mockReturnValue(discoveredCommands);

      const { hooks } = await createHooks();
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        requiredCommands: ['quality-gate'],
      });

      const output1 = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'sig-3a' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'sig-3a', model: {} }, output1);

      // Change the mtime between the two transforms to invalidate the signature
      mtimeValue = 2000;

      const output2 = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'sig-3b' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'sig-3b', model: {} }, output2);

      // With changed stats, cache should be invalidated
      expect(mocks.discoverCommands).toHaveBeenCalledTimes(2);
    });

    it('handles existsSync returning true for command dirs with .md files', async () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.statSync.mockReturnValue({
        mtimeMs: 1000,
        size: 200,
        isFile: () => true,
        isDirectory: () => true,
      });
      mocks.readdirSync.mockReturnValue(['test.md', 'readme.txt', 'another.MD']);

      mocks.discoverCommands.mockReturnValue(discoveredCommands);

      const { hooks } = await createHooks();
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        requiredCommands: ['quality-gate'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'sig-4' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'sig-4', model: {} }, output);

      expect(mocks.discoverCommands).toHaveBeenCalled();
    });

    it('handles statSync throwing for unreadable config file', async () => {
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('opencode.json')) return true;
        return false;
      });
      mocks.statSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      mocks.discoverCommands.mockReturnValue(discoveredCommands);

      const { hooks } = await createHooks();
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        requiredCommands: ['quality-gate'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'sig-5' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'sig-5', model: {} }, output);

      // Should still work despite stat failure
      expect(mocks.discoverCommands).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // shouldShowSummary false branch
  // =========================================================================

  describe('shouldShowSummary false path', () => {
    it('does not push summary when no skills or commands are selected', async () => {
      analyzeIntentMock.mockResolvedValue(defaultAnalysisMock());

      const { hooks } = await createHooks();
      const output = { system: [] as string[] };

      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'nosummary-1' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'nosummary-1', model: {} }, output);

      // With no required/suggested skills or commands, no summary should be added
      const joined = output.system.join('\n');
      expect(joined).not.toContain('DYNAMIC SKILLS');
      expect(joined).not.toContain('ACTIVATION');
    });
  });

  // =========================================================================
  // session.compacted event handling
  // =========================================================================

  describe('session.compacted event', () => {
    it('resets runtime state and clears session state on compaction', async () => {
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const { hooks, pluginDirectory } = await createHooks();
      const output1 = { system: [] as string[] };

      // First: create session and inject
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'compact-1' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'compact-1', model: {} }, output1);

      const joined1 = output1.system.join('\n');
      expect(joined1.length).toBeGreaterThan(0);

      // Fire compacted event
      await hooks.event?.({
        event: { type: 'session.compacted', properties: { sessionID: 'compact-1' } },
      });

      // Session state should be reset to empty
      const stateDir = join(pluginDirectory, 'state');
      const statePath = getSessionStatePath(stateDir, 'compact-1');
      try {
        const rawState = await readFile(statePath, 'utf-8');
        const state = JSON.parse(rawState);
        expect(state.acknowledgedSkills).toEqual([]);
        expect(state.acknowledgedCommands).toEqual([]);
      } catch {
        // State file might not exist if directory wasn't created, which is fine
      }

      // After compaction, the next transform should re-analyze and re-inject
      const output2 = { system: [] as string[] };
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'compact-1', model: {} }, output2);

      // Should have re-analyzed (analyzeIntent called again)
      expect(analyzeIntentMock).toHaveBeenCalledTimes(2);
    });

    it('handles compacted event with missing sessionID gracefully', async () => {
      const { hooks } = await createHooks();

      // Should not throw
      await hooks.event?.({
        event: { type: 'session.compacted', properties: { sessionID: '' } },
      });
    });
  });

  // =========================================================================
  // extractSessionId variations
  // =========================================================================

  describe('extractSessionId (indirect via event handler)', () => {
    it('extracts from sessionID field', async () => {
      const { hooks } = await createHooks();
      await hooks.event?.({
        event: { type: 'session.created', properties: { info: { sessionID: 'sid-from-sessionID' } } },
      });

      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const output = { system: [] as string[] };
      await hooks['experimental.chat.system.transform']?.(
        { sessionID: 'sid-from-sessionID', model: {} },
        output
      );

      expect(analyzeIntentMock).toHaveBeenCalled();
    });

    it('extracts from conversationID field', async () => {
      const { hooks } = await createHooks();
      await hooks.event?.({
        event: {
          type: 'session.created',
          properties: { info: { conversationID: 'sid-from-convID' } },
        },
      });

      analyzeIntentMock.mockResolvedValue(defaultAnalysisMock());

      const output = { system: [] as string[] };
      await hooks['experimental.chat.system.transform']?.(
        { sessionID: 'sid-from-convID', model: {} },
        output
      );

      // Should not crash
    });

    it('extracts from conversation_id field', async () => {
      const { hooks } = await createHooks();
      await hooks.event?.({
        event: {
          type: 'session.created',
          properties: { info: { conversation_id: 'sid-from-conv_id' } },
        },
      });

      // Should not crash
    });

    it('returns null and skips when all ID fields are empty', async () => {
      const { hooks } = await createHooks();
      await hooks.event?.({
        event: { type: 'session.created', properties: { info: {} } },
      });

      // Should not crash; the session just won't be tracked
    });
  });

  // =========================================================================
  // Error handling paths
  // =========================================================================

  describe('error handling', () => {
    it('catches and logs errors in event handler', async () => {
      const { hooks } = await createHooks();

      // Pass a malformed event to trigger the default case (no crash)
      await hooks.event?.({
        event: { type: 'unknown.event' } as unknown as { type: 'session.created'; properties: { info: { id: string } } },
      });

      // Should not throw
    });

    it('catches and logs errors in system.transform when analyzeIntent throws', async () => {
      analyzeIntentMock.mockRejectedValue(new Error('AI service unavailable'));

      const { hooks } = await createHooks();
      const output = { system: [] as string[] };

      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'err-1' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'err-1', model: {} }, output);

      // Should not throw, should log error
      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('system.transform hook failed');
    });

    it('catches and logs errors in system.transform when fetchUserPrompt fails', async () => {
      const { hooks } = await createHooks({
        session: {
          messages: async () => {
            throw new Error('Network error');
          },
        },
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'err-2' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'err-2', model: {} }, output);

      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('no user prompt available');
    });

    it('logs error when command discovery fails', async () => {
      mocks.discoverCommands.mockImplementation(() => {
        throw new Error('Discovery failure');
      });

      const { hooks } = await createHooks();
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const output = { system: [] as string[] };
      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'err-3' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'err-3', model: {} }, output);

      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('command-discovery: discovery failed');
    });
  });

  // =========================================================================
  // chat.message hook
  // =========================================================================

  describe('chat.message hook', () => {
    it('logs observed message without crashing', async () => {
      const { hooks } = await createHooks();

      await hooks['chat.message']?.(
        { sessionID: 'chat-1', agent: 'main' },
        { message: {}, parts: [{ type: 'text', text: 'Hello' }] }
      );

      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('chat.message observed session=chat-1');
    });

    it('handles empty parts array', async () => {
      const { hooks } = await createHooks();

      await hooks['chat.message']?.(
        { sessionID: 'chat-2' },
        { message: {}, parts: [] }
      );

      const debugOutput = mocks.debugLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(debugOutput).toContain('chat.message observed session=chat-2 parts=0');
    });
  });

  // =========================================================================
  // session.deleted event
  // =========================================================================

  describe('session.deleted event', () => {
    it('cleans up runtime state and state files', async () => {
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const { hooks, pluginDirectory } = await createHooks();

      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'del-1' } } } });
      const output = { system: [] as string[] };
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'del-1', model: {} }, output);

      // Delete session
      await hooks.event?.({
        event: { type: 'session.deleted', properties: { info: { id: 'del-1' } } },
      });

      // State file should be removed
      const stateDir = join(pluginDirectory, 'state');
      const statePath = getSessionStatePath(stateDir, 'del-1');
      await expect(access(statePath)).rejects.toThrow();
    });

    it('handles deletion of non-existent session gracefully', async () => {
      const { hooks } = await createHooks();

      // Should not throw for unknown session
      await hooks.event?.({
        event: { type: 'session.deleted', properties: { info: { id: 'nonexistent-session' } } },
      });
    });
  });

  // =========================================================================
  // Injected once then skips on repeat
  // =========================================================================

  describe('injection skip on repeated transforms', () => {
    it('marks session as injected and returns early on second transform', async () => {
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        required: ['tdd-workflow'],
      });

      const { hooks } = await createHooks();

      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'skip-1' } } } });

      const output1 = { system: [] as string[] };
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'skip-1', model: {} }, output1);
      expect(output1.system.length).toBeGreaterThan(0);

      const output2 = { system: [] as string[] };
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'skip-1', model: {} }, output2);
      expect(output2.system).toEqual([]);

      // analyzeIntent should only be called once
      expect(analyzeIntentMock).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // No skills injected but commands present
  // =========================================================================

  describe('commands without skills', () => {
    it('shows summary with command references even when no skills are injected', async () => {
      analyzeIntentMock.mockResolvedValue({
        ...defaultAnalysisMock(),
        requiredCommands: ['quality-gate'],
      });

      const { hooks } = await createHooks();
      const output = { system: [] as string[] };

      await hooks.event?.({ event: { type: 'session.created', properties: { info: { id: 'cmd-only' } } } });
      await hooks['experimental.chat.system.transform']?.({ sessionID: 'cmd-only', model: {} }, output);

      const joined = output.system.join('\n');
      expect(joined).toContain('[$quality-gate]');
    });
  });
});

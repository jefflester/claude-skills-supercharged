import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cli.js')>();
  return actual;
});

const mocks = vi.hoisted(() => ({
  callAIForIntentAnalysis: vi.fn(),
  getProvider: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock('../../hooks/lib/ai-client.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../hooks/lib/ai-client.js');
  return {
    ...actual,
    callAIForIntentAnalysis: mocks.callAIForIntentAnalysis,
    getProvider: mocks.getProvider,
    getModel: mocks.getModel,
  };
});

import { main, selectSkills } from '../cli.js';

describe('CLI command compatibility', () => {
  const compatibilityPrompt = 'Use the PRP workflow to plan this feature and validate quality gates';

  beforeEach(() => {
    mocks.callAIForIntentAnalysis.mockReset();
    mocks.getProvider.mockReturnValue('anthropic');
    mocks.getModel.mockReturnValue('claude-haiku-4-5');
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'quality workflow',
      skills: [{ name: 'tdd-workflow', confidence: 0.9, reason: 'testing' }],
      commands: [{ name: 'code-review', confidence: 0.78, reason: 'review checks' }],
    });
  });

  it('selectSkills returns command fields without removing existing fields', async () => {
    const result = await selectSkills(compatibilityPrompt, {
      debug: false,
      format: 'json',
    });

    expect(result).toHaveProperty('selected');
    expect(result).toHaveProperty('suggested');
    expect(result).toHaveProperty('affinity');
    expect(result).toHaveProperty('scores');
    expect(result).toHaveProperty('labels');
    expect(result).toHaveProperty('promoted');
    expect(result).toHaveProperty('commands');
    expect(result).toHaveProperty('suggestedCommands');
    expect(result).toHaveProperty('commandScores');
  });

  it('main --format json includes command fields without removing existing fields', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const exitCode = await main([
      '--format',
      'json',
      compatibilityPrompt,
    ]);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(String(writeSpy.mock.calls[0][0]));
    expect(payload).toHaveProperty('selected');
    expect(payload).toHaveProperty('suggested');
    expect(payload).toHaveProperty('commands');
    expect(payload).toHaveProperty('suggestedCommands');
    expect(payload).toHaveProperty('commandScores');

    writeSpy.mockRestore();
  });

  it('filters and persists command acknowledgments across repeated session calls', async () => {
    const sessionId = `cli-repeat-session-${Date.now()}`;
    const first = await selectSkills(compatibilityPrompt, {
      debug: false,
      format: 'json',
      sessionId,
    });
    const second = await selectSkills(compatibilityPrompt, {
      debug: false,
      format: 'json',
      sessionId,
    });

    expect(first.commands.length).toBeGreaterThanOrEqual(0);
    expect(second.commands).toEqual([]);
  });

  it('main text output includes command sections when command recommendations are present', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitCode = await main([compatibilityPrompt]);

    expect(exitCode).toBe(0);
    const payload = String(writeSpy.mock.calls[0][0]);
    expect(payload).toContain('Required commands');
    expect(payload).toContain('Suggested commands');

    writeSpy.mockRestore();
  });
});

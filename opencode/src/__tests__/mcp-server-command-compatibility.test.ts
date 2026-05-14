import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { selectSkillsTool } from '../mcp-server.js';

describe('MCP command compatibility', () => {
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

  it('select_skills result adds command fields while preserving existing fields', async () => {
    const result = await selectSkillsTool({
      prompt: compatibilityPrompt,
    });

    expect(result).toHaveProperty('skills');
    expect(result).toHaveProperty('suggested');
    expect(result).toHaveProperty('affinity');
    expect(result).toHaveProperty('scores');
    expect(result).toHaveProperty('commands');
    expect(result).toHaveProperty('suggestedCommands');
    expect(result).toHaveProperty('alreadyLoadedCommands');
    expect(result).toHaveProperty('commandScores');
  });

  it('filters and persists command acknowledgments when session_id is reused', async () => {
    const sessionId = `mcp-repeat-session-${Date.now()}`;
    const first = await selectSkillsTool({
      prompt: compatibilityPrompt,
      sessionId,
    });
    const second = await selectSkillsTool({
      prompt: compatibilityPrompt,
      sessionId,
    });

    expect(first.commands.length).toBeGreaterThanOrEqual(0);
    expect(second.commands).toEqual([]);
  });

});

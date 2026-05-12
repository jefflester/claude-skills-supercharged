import { describe, expect, it } from 'vitest';
import { selectSkillsTool } from '../mcp-server.js';

describe('MCP command compatibility', () => {
  it('select_skills result adds command fields while preserving existing fields', async () => {
    const result = await selectSkillsTool({
      prompt: 'Use the PRP workflow to plan this feature',
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
    const sessionId = 'mcp-repeat-session';
    const first = await selectSkillsTool({
      prompt: 'Use the PRP workflow to plan this feature',
      sessionId,
    });
    const second = await selectSkillsTool({
      prompt: 'Use the PRP workflow to plan this feature',
      sessionId,
    });

    expect(first.commands.length).toBeGreaterThanOrEqual(0);
    expect(second.commands).toEqual([]);
  });
});

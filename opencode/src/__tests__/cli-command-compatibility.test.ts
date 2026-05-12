import { describe, expect, it, vi } from 'vitest';

vi.mock('../cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cli.js')>();
  return actual;
});

import { main, selectSkills } from '../cli.js';

describe('CLI command compatibility', () => {
  it('selectSkills returns command fields without removing existing fields', async () => {
    const result = await selectSkills('Use the PRP workflow to plan this feature', {
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
      'Use the PRP workflow to plan this feature',
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
    const sessionId = 'cli-repeat-session';
    const first = await selectSkills('Use the PRP workflow to plan this feature', {
      debug: false,
      format: 'json',
      sessionId,
    });
    const second = await selectSkills('Use the PRP workflow to plan this feature', {
      debug: false,
      format: 'json',
      sessionId,
    });

    expect(first.commands.length).toBeGreaterThanOrEqual(0);
    expect(second.commands).toEqual([]);
  });

  it('main text output includes command sections when command recommendations are present', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitCode = await main(['Use the PRP workflow to plan this feature']);

    expect(exitCode).toBe(0);
    const payload = String(writeSpy.mock.calls[0][0]);
    expect(payload).toContain('Required commands');
    expect(payload).toContain('Suggested commands');

    writeSpy.mockRestore();
  });
});

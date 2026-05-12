import { describe, expect, it } from 'vitest';
import {
  formatMandatoryCommandReferences,
  formatSuggestedCommandReferences,
} from '../output-formatter.js';
import type { CommandRule } from '../types.js';

const commandRules: Record<string, CommandRule> = {
  'quality-gate': {
    description: 'Run ECC quality gate',
    template: 'Run quality checks.\n!npm test\nReview @src/secret.ts with $ARGUMENTS.',
    source: 'markdown',
    sourcePath: 'D:\\AI\\GlobalRepo\\commands\\opencode\\ecc\\quality-gate.md',
  },
  'code-review': {
    description: 'Review code changes',
    template: 'Full review body should never be injected.',
    source: 'config',
    sourcePath: 'D:\\AI\\OpenCode\\runtime\\config\\opencode\\opencode.json',
  },
};

describe('command output formatter', () => {
  it('formats mandatory command references without injecting command bodies or placeholders', () => {
    const output = formatMandatoryCommandReferences(['quality-gate'], commandRules, {
      'quality-gate': 0.94,
    });

    expect(output).toContain(
      '[$quality-gate](D:\\AI\\GlobalRepo\\commands\\opencode\\ecc\\quality-gate.md)'
    );
    expect(output).toContain('0.94');
    expect(output).not.toContain('!npm test');
    expect(output).not.toContain('@src/secret.ts');
    expect(output).not.toContain('$ARGUMENTS');
  });

  it('formats suggested command references separately from mandatory references', () => {
    const output = formatSuggestedCommandReferences(['code-review'], commandRules, {
      'code-review': 0.78,
    });

    expect(output).toContain('SUGGESTED COMMANDS');
    expect(output).toContain(
      '[$code-review](D:\\AI\\OpenCode\\runtime\\config\\opencode\\opencode.json)'
    );
    expect(output).toContain('0.78');
    expect(output).not.toContain('Full review body should never be injected.');
    expect(output).not.toContain('Review code changes');
  });

  it('preserves valid command name characters such as dots', () => {
    const output = formatMandatoryCommandReferences(
      ['release.v1', 'prp.plan'],
      {
        'release.v1': {
          description: 'release command',
          template: 'hidden',
          source: 'markdown',
          sourcePath: 'D:\\AI\\GlobalRepo\\commands\\opencode\\ecc\\release.v1.md',
        },
        'prp.plan': {
          description: 'plan command',
          template: 'hidden',
          source: 'markdown',
          sourcePath: 'D:\\AI\\GlobalRepo\\commands\\opencode\\ecc\\prp.plan.md',
        },
      },
      {}
    );

    expect(output).toContain('[$release.v1]');
    expect(output).toContain('[$prp.plan]');
  });

  it('sanitizes multiline and prompt-like command names', () => {
    const output = formatMandatoryCommandReferences(
      ['weird\ncommand'],
      {},
      {}
    );

    expect(output).toContain('/weird command');
  });

  it('wraps source paths containing spaces in markdown link angle brackets', () => {
    const output = formatMandatoryCommandReferences(
      ['space-command'],
      {
        'space-command': {
          description: 'space command',
          template: 'hidden',
          source: 'markdown',
          sourcePath: 'D:\\AI\\Global Repo\\commands\\space-command.md',
        },
      },
      {}
    );

    expect(output).toContain(
      '[$space-command](<D:\\AI\\Global Repo\\commands\\space-command.md>)'
    );
  });
});

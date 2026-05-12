import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildCommandRuleFromMarkdown,
  discoverCommands,
  discoverCommandsFromDirectory,
  parseJsoncLike,
  resolveCommandDiscoveryOptions,
} from '../command-discovery.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'command-discovery-'));
}

describe('command discovery', () => {
  it('builds a command rule from markdown frontmatter and body', () => {
    const rule = buildCommandRuleFromMarkdown(
      'prp-plan',
      `---
description: Create a PRP plan
agent: planner
subtask: true
model: openai/gpt-5.2
---

Create a detailed plan for $ARGUMENTS.
!npm test
`,
      'C:\\commands\\prp-plan.md'
    );

    expect(rule).toMatchObject({
      description: 'Create a PRP plan',
      agent: 'planner',
      subtask: true,
      model: 'openai/gpt-5.2',
      template: 'Create a detailed plan for $ARGUMENTS.\n!npm test',
      source: 'markdown',
      sourcePath: 'C:\\commands\\prp-plan.md',
    });
  });

  it('discovers markdown commands and skips unreadable or non-markdown entries', () => {
    const commandsDir = makeTempDir();
    mkdirSync(join(commandsDir, 'nested'));
    writeFileSync(
      join(commandsDir, 'quality-gate.md'),
      `---
description: Run quality gate
---
Check the affected scope.`
    );
    writeFileSync(join(commandsDir, 'notes.txt'), 'not a command');

    expect(discoverCommandsFromDirectory(commandsDir)).toMatchObject({
      'quality-gate': {
        description: 'Run quality gate',
        template: 'Check the affected scope.',
        source: 'markdown',
      },
    });
  });

  it('discovers config commands and lets config override markdown duplicates', () => {
    const root = makeTempDir();
    const commandsDir = join(root, 'commands');
    mkdirSync(commandsDir);
    writeFileSync(
      join(commandsDir, 'review.md'),
      `---
description: Markdown review
---
Markdown body.`
    );
    const configPath = join(root, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        command: {
          review: {
            template: 'Config body.',
            description: 'Config review',
            agent: 'build',
          },
          tdd: {
            template: 'Use TDD for $ARGUMENTS.',
            description: 'TDD workflow',
            subtask: true,
          },
        },
      })
    );

    expect(discoverCommands({ configPath, commandsDirs: [commandsDir] })).toMatchObject({
      review: {
        description: 'Config review',
        template: 'Config body.',
        source: 'config',
        agent: 'build',
      },
      tdd: {
        description: 'TDD workflow',
        template: 'Use TDD for $ARGUMENTS.',
        source: 'config',
        subtask: true,
      },
    });
  });

  it('parses JSONC-like config with comments and trailing commas', () => {
    const root = makeTempDir();
    const configPath = join(root, 'opencode.json');
    writeFileSync(
      configPath,
      `{
        // commands with trailing commas
        "command": {
          "release.v1": {
            "template": "Release body",
            "description": "Release flow",
          },
        },
      }`
    );

    const discovered = discoverCommands({ configPath, commandsDirs: [] });
    expect(discovered).toMatchObject({
      'release.v1': {
        description: 'Release flow',
        template: 'Release body',
        source: 'config',
      },
    });
  });

  it('preserves comment-like and URL text inside JSON strings', () => {
    const parsed = parseJsoncLike(`{
      // comment
      "command": {
        "release.v1": {
          "template": "See https://example.com/path?x=1,2 and //keep and /*keep*/",
          "description": "Text with // and /* */ and comma,}",
        },
      },
    }`) as {
      command: Record<string, { template: string; description: string }>;
    };

    expect(parsed.command['release.v1'].template).toContain('https://example.com/path?x=1,2');
    expect(parsed.command['release.v1'].template).toContain('//keep');
    expect(parsed.command['release.v1'].template).toContain('/*keep*/');
    expect(parsed.command['release.v1'].description).toContain('comma,}');
  });

  it('returns an empty registry when paths are missing or invalid', () => {
    expect(
      discoverCommands({
        configPath: 'C:\\definitely-missing\\opencode.json',
        commandsDirs: ['C:\\definitely-missing\\commands'],
      })
    ).toEqual({});
  });

  it('supports OPENCODE_CONFIG_PATH and OPENCODE_COMMANDS_DIR aliases', () => {
    const previousConfig = process.env.OPENCODE_CONFIG_PATH;
    const previousCommandsDir = process.env.OPENCODE_COMMANDS_DIR;
    process.env.OPENCODE_CONFIG_PATH = 'C:\\alias\\opencode.json';
    process.env.OPENCODE_COMMANDS_DIR = 'C:\\alias\\commands';

    try {
      const options = resolveCommandDiscoveryOptions('C:\\project');
      expect(options.configPath).toBe('C:\\alias\\opencode.json');
      expect(options.commandsDirs).toContain('C:\\alias\\commands');
    } finally {
      if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG_PATH;
      else process.env.OPENCODE_CONFIG_PATH = previousConfig;
      if (previousCommandsDir === undefined) delete process.env.OPENCODE_COMMANDS_DIR;
      else process.env.OPENCODE_COMMANDS_DIR = previousCommandsDir;
    }
  });

  it('rejects symlinked command files', () => {
    const root = makeTempDir();
    const commandsDir = join(root, 'commands');
    const external = join(root, 'outside.md');
    mkdirSync(commandsDir);
    writeFileSync(external, '---\ndescription: external\n---\nbody');

    const symlinkPath = join(commandsDir, 'external.md');
    try {
      symlinkSync(external, symlinkPath);
    } catch {
      return; // symlink creation may be unavailable in CI/user mode
    }

    const discovered = discoverCommandsFromDirectory(commandsDir);
    expect(discovered).toEqual({});
  });

  it('rejects invalid/malicious command names from config and markdown and preserves dotted names', () => {
    const root = makeTempDir();
    const commandsDir = join(root, 'commands');
    mkdirSync(commandsDir);
    writeFileSync(join(commandsDir, 'release.v1.md'), '---\ndescription: ok\n---\nbody');
    writeFileSync(join(commandsDir, 'bad name.md'), '---\ndescription: bad\n---\nbody');
    writeFileSync(join(commandsDir, '__proto__.md'), '---\ndescription: bad\n---\nbody');

    const configPath = join(root, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        command: {
          'prp.plan': { template: 'ok', description: 'ok' },
          'bad name': { template: 'bad', description: 'bad' },
          'inject\rsystem': { template: 'bad', description: 'bad' },
          __proto__: { template: 'bad', description: 'bad' },
          constructor: { template: 'bad', description: 'bad' },
          prototype: { template: 'bad', description: 'bad' },
        },
      })
    );

    const discovered = discoverCommands({ configPath, commandsDirs: [commandsDir] });
    expect(discovered).toHaveProperty('release.v1');
    expect(discovered).toHaveProperty('prp.plan');
    expect(discovered).not.toHaveProperty('bad name');
    expect(discovered).not.toHaveProperty('inject\rsystem');
    expect(discovered).not.toHaveProperty('__proto__');
    expect(discovered).not.toHaveProperty('constructor');
    expect(discovered).not.toHaveProperty('prototype');
  });
});

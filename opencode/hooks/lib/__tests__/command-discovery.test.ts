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
type: guardrail
autoInject: true
promptTriggers.keywords: prp, plan
requiredCommands: verify, update-docs
injectionOrder: 12
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
      type: 'guardrail',
      description: 'Create a PRP plan',
      workflowPhase: 'Planning & Architecture',
      autoInject: true,
      requiredCommands: ['verify', 'update-docs'],
      injectionOrder: 12,
      promptTriggers: { keywords: ['prp', 'plan'] },
      agent: 'planner',
      subtask: true,
      model: 'openai/gpt-5.2',
      template: 'Create a detailed plan for $ARGUMENTS.\n!npm test',
      source: 'markdown',
      sourcePath: 'C:\\commands\\prp-plan.md',
    });
    expect(rule.summary).toBeUndefined();
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
            summary: 'Use this to perform a final code review gate.',
            type: 'guardrail',
            autoInject: true,
            requiredCommands: ['verify'],
            injectionOrder: 20,
            promptTriggers: { keywords: ['review', 'diff'] },
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
        type: 'guardrail',
        description: 'Config review',
        summary: expect.stringContaining('final code review gate'),
        autoInject: true,
        requiredCommands: ['verify'],
        injectionOrder: 20,
        promptTriggers: { keywords: ['review', 'diff'] },
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

  it('derives bounded sanitized summary from markdown body when explicit summary is absent', () => {
    const rule = buildCommandRuleFromMarkdown(
      'verify',
      `---
description: Verify implementation quality thoroughly.
---
## Intent
Confirm quality and test coverage before final delivery.
!npm test
@secrets.env
$ARGUMENTS
\`\`\`bash
pnpm run check
\`\`\`
token=abc123
`,
      'C:\\commands\\verify.md'
    );

    expect(rule.workflowPhase).toBe('Testing');
    expect(rule.summary).toContain('Confirm quality and test coverage before final delivery.');
    expect(rule.summary).not.toContain('!npm test');
    expect(rule.summary).not.toContain('@secrets.env');
    expect(rule.summary).not.toContain('$ARGUMENTS');
    expect(rule.summary).not.toContain('pnpm run check');
    expect((rule.summary || '').length).toBeLessThanOrEqual(320);
  });

  it('skips fenced code block content and list-prefixed shell commands in derived summary', () => {
    const rule = buildCommandRuleFromMarkdown(
      'verify',
      `---
description: Verify command
---
- npm test
1. cargo build
\`\`\`bash
echo "should not leak"
pytest -q
\`\`\`
## Goal
Capture final verification intent in prose.
`,
      'C:\\commands\\verify.md'
    );

    expect(rule.summary).toContain('Goal');
    expect(rule.summary).toContain('Capture final verification intent in prose.');
    expect(rule.summary).not.toContain('npm test');
    expect(rule.summary).not.toContain('cargo build');
    expect(rule.summary).not.toContain('should not leak');
    expect(rule.summary).not.toContain('pytest -q');
  });

  it('removes inline shell command syntax from explicit summaries while keeping prose', () => {
    const rule = buildCommandRuleFromMarkdown(
      'quality-gate',
      `---
description: Quality gate command
summary: Run npm test before merge, then pnpm run check, and validate the final result quality.
---
Template body.`,
      'C:\\commands\\quality-gate.md'
    );

    expect(rule.summary).toContain('validate the final result quality');
    expect(rule.summary).not.toContain('npm test');
    expect(rule.summary).not.toContain('pnpm run check');
    expect(rule.summary).not.toContain('Run npm');
    expect(rule.summary).not.toContain('then pnpm');
  });

  it('removes inline repo command forms and preserves scoped package prose', () => {
    const rule = buildCommandRuleFromMarkdown(
      'quality-gate',
      `---
description: Quality gate command
summary: Run npx tsx scripts/check.ts, then bunx vitest run command and tsc --noEmit. Use @types/node for type support and keep eslint guidance documented.
---
Template body.`,
      'C:\\commands\\quality-gate.md'
    );

    expect(rule.summary).not.toContain('npx tsx');
    expect(rule.summary).not.toContain('bunx vitest run');
    expect(rule.summary).not.toContain('tsc --noEmit');
    expect(rule.summary).toContain('@types/node');
    expect(rule.summary).toContain('keep eslint guidance documented');
  });

  it('preserves normal prose with tool words and slash-delimited terms', () => {
    const rule = buildCommandRuleFromMarkdown(
      'quality-gate',
      `---
description: Quality gate command
summary: Use npm package updates and validate CI/CD request/response auth/secret behavior. Go through the checklist and make sure docs are updated.
---
Template body.`,
      'C:\\commands\\quality-gate.md'
    );

    expect(rule.summary).toContain('Use npm package updates');
    expect(rule.summary).toContain('CI/CD');
    expect(rule.summary).toContain('request/response');
    expect(rule.summary).toContain('auth/secret');
    expect(rule.summary).toContain('Go through the checklist');
    expect(rule.summary).toContain('make sure docs are updated');
  });

  it('keeps imperative prose lines while filtering actual shell lines', () => {
    const rule = buildCommandRuleFromMarkdown(
      'verify',
      `---
description: Verify command
---
Go through the verification checklist for release readiness.
Make sure docs are updated before sign-off.
go test ./...
make test
`,
      'C:\\commands\\verify.md'
    );

    expect(rule.summary).toContain('Go through the verification checklist');
    expect(rule.summary).toContain('Make sure docs are updated');
    expect(rule.summary).not.toContain('go test ./...');
    expect(rule.summary).not.toContain('make test');
  });

  it('filters line-based npx/bunx/tsx/tsc/eslint/vitest commands from derived summaries', () => {
    const rule = buildCommandRuleFromMarkdown(
      'verify',
      `---
description: Verify command
---
npx tsx scripts/verify.ts
bunx vitest run command-discovery
tsx scripts/check.ts
tsc --noEmit
eslint .
eslint --fix
vitest run command
Preserve this prose line for summary context.
`,
      'C:\\commands\\verify.md'
    );

    expect(rule.summary).toContain('Preserve this prose line for summary context.');
    expect(rule.summary).not.toContain('npx tsx');
    expect(rule.summary).not.toContain('bunx vitest run');
    expect(rule.summary).not.toContain('tsx scripts/check.ts');
    expect(rule.summary).not.toContain('tsc --noEmit');
    expect(rule.summary).not.toContain('eslint .');
    expect(rule.summary).not.toContain('eslint --fix');
    expect(rule.summary).not.toContain('vitest run');
  });

  it('removes only placeholder-style @ references while preserving scoped packages', () => {
    const rule = buildCommandRuleFromMarkdown(
      'quality-gate',
      `---
description: Quality gate command
summary: Resolve @types/node and @babel/core compatibility, then reference @./local/file.md and @/abs/path.md placeholders.
---
Template body.`,
      'C:\\commands\\quality-gate.md'
    );

    expect(rule.summary).toContain('@types/node');
    expect(rule.summary).toContain('@babel/core');
    expect(rule.summary).not.toContain('@/abs/path.md');
    expect(rule.summary).not.toContain('@./local/file.md');
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

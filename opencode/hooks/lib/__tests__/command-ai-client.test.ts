import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, parseIntentAnalysis } from '../ai-client.js';
import * as debugLogger from '../debug-logger.js';
import type { CommandRule, SkillRule } from '../types.js';

const skills: Record<string, SkillRule> = {
  'tdd-workflow': {
    type: 'domain',
    description: 'Use test driven development.',
  },
};

const commands: Record<string, CommandRule> = {
  'quality-gate': {
    description: 'Run the ECC quality gate.',
    workflowPhase: 'Code Review',
    summary: 'Validate lint, tests, and typecheck before merge.',
    template: 'Full command body with !npm test and @file should only be used as scoring preview.',
    agent: 'build-error-resolver',
    source: 'markdown',
  },
};

describe('command-aware AI client', () => {
  it('parses command-aware JSON while preserving skill parsing', () => {
    expect(
      parseIntentAnalysis(`{
        "primary_intent": "run quality checks",
        "skills": [
          {"name": "tdd-workflow", "confidence": 0.81, "reason": "tests requested"}
        ],
        "skill_rankings": [
          {"name": "tdd-workflow", "confidence": 0.81},
          {"name": "unrelated", "confidence": 0.12}
        ],
        "commands": [
          {"name": "quality-gate", "confidence": 0.92, "reason": "quality gate requested"}
        ]
      }`)
    ).toEqual({
      primary_intent: 'run quality checks',
      skills: [{ name: 'tdd-workflow', confidence: 0.81, reason: 'tests requested' }],
      skill_rankings: [
        { name: 'tdd-workflow', confidence: 0.81 },
        { name: 'unrelated', confidence: 0.12 },
      ],
      commands: [{ name: 'quality-gate', confidence: 0.92, reason: 'quality gate requested' }],
    });
  });

  it('treats missing commands as an empty command list for backwards compatibility', () => {
    expect(
      parseIntentAnalysis(`{
        "primary_intent": "write tests",
        "skills": [
          {"name": "tdd-workflow", "confidence": 0.9, "reason": "tests requested"}
        ]
      }`).commands
    ).toEqual([]);
  });

  it('includes command names, workflow phase, and summary in the prompt without template previews', () => {
    const prompt = buildPrompt('Run checks', skills, commands);

    expect(prompt).toContain('Available commands');
    expect(prompt).toContain('- quality-gate: Run the ECC quality gate.');
    expect(prompt).toContain('Workflow phase: Code Review.');
    expect(prompt).toContain('Summary: Validate lint, tests, and typecheck before merge.');
    expect(prompt).not.toContain('!npm test');
    expect(prompt).not.toContain('@file');
    expect(prompt).not.toContain('scoring preview');
  });

  it('renders skill and command thresholds from the runtime constants', () => {
    const prompt = buildPrompt('Run checks', skills, commands);

    expect(prompt).toContain('>= 0.65: REQUIRED skill reference');
    expect(prompt).toContain('0.50 to < 0.65: SUGGESTED skill reference');
    expect(prompt).toContain('>= 0.90: REQUIRED command reference');
    expect(prompt).toContain('0.70 to < 0.90: SUGGESTED command reference');
    expect(prompt).toContain('skill_rankings array that includes EVERY available skill exactly once');
    expect(prompt).toContain('TOP 5 most relevant skills and TOP 5 most relevant commands');
    expect(prompt).not.toContain('> 0.65: REQUIRED (auto-injected as critical skill)');
  });

  it('logs when command descriptions are truncated by the prompt budget', () => {
    const debugSpy = vi.spyOn(debugLogger, 'debugLog').mockImplementation(() => undefined);
    const oversizedCommands: Record<string, CommandRule> = {};

    for (let i = 0; i < 120; i += 1) {
      oversizedCommands[`command-${i}`] = {
        description: `Command ${i} description ${'x'.repeat(220)}`,
        summary: `Summary ${i} ${'y'.repeat(320)}`,
        workflowPhase: 'Code Review',
        template: 'Template body',
        source: 'markdown',
      };
    }

    const prompt = buildPrompt('Run checks', skills, oversizedCommands);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('truncated command descriptions for prompt budget')
    );
    expect(prompt).toContain('NOTE: Command references truncated due to prompt budget.');
    expect(prompt).toMatch(/Omitted \d+ command reference\(s\)\./);
    const commandBlockMatch = prompt.match(
      /Available commands:\r?\n([\s\S]*?)\r?\n\r?\nIMPORTANT SCORING GUIDANCE:/
    );
    expect(commandBlockMatch?.[1]).toBeDefined();
    expect((commandBlockMatch?.[1] || '').length).toBeLessThanOrEqual(25000);
    debugSpy.mockRestore();
  });
});

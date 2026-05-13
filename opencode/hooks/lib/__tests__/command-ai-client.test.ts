import { describe, expect, it } from 'vitest';
import { buildPrompt, parseIntentAnalysis } from '../ai-client.js';
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
        "commands": [
          {"name": "quality-gate", "confidence": 0.92, "reason": "quality gate requested"}
        ]
      }`)
    ).toEqual({
      primary_intent: 'run quality checks',
      skills: [{ name: 'tdd-workflow', confidence: 0.81, reason: 'tests requested' }],
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

  it('includes command names and descriptions in the prompt without command metadata or template previews', () => {
    const prompt = buildPrompt('Run checks', skills, commands);

    expect(prompt).toContain('Available commands');
    expect(prompt).toContain('- quality-gate: Run the ECC quality gate.');
    expect(prompt).not.toContain('Agent: build-error-resolver');
    expect(prompt).not.toContain('Source: markdown');
    expect(prompt).not.toContain('!npm test');
    expect(prompt).not.toContain('@file');
    expect(prompt).not.toContain('scoring preview');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAIForIntentAnalysis: vi.fn(),
  readCache: vi.fn(),
  writeCache: vi.fn(),
}));

vi.mock('../ai-client.js', () => ({
  callAIForIntentAnalysis: mocks.callAIForIntentAnalysis,
}));

vi.mock('../cache-manager.js', () => ({
  readCache: mocks.readCache,
  writeCache: mocks.writeCache,
}));

import { analyzeIntent } from '../intent-analyzer.js';
import type { CommandRule, SkillRule } from '../types.js';

const skills: Record<string, SkillRule> = {
  'tdd-workflow': {
    type: 'domain',
    description: 'Testing workflow',
    promptTriggers: { keywords: ['test', 'testing'] },
  },
};

const commands: Record<string, CommandRule> = {
  'quality-gate': {
    description: 'Run the ECC quality gate',
    template: 'Quality body',
    promptTriggers: { keywords: ['quality', 'gate'] },
    source: 'markdown',
  },
  'code-review': {
    description: 'Review code changes',
    template: 'Review body',
    source: 'markdown',
  },
  'template-only': {
    description: 'No keyword match',
    template: 'Contains unique-template-token',
    source: 'markdown',
  },
  'prp.plan': {
    description: 'Create PRP plan',
    template: 'Unused in metadata fallback',
    promptTriggers: { keywords: ['prp', 'plan'] },
    source: 'markdown',
  },
  unrelated: {
    description: 'Publish a social media post',
    template: 'Unused unrelated command',
    source: 'markdown',
  },
};

describe('command-aware intent analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCache.mockReturnValue(null);
  });

  it('returns categorized command tiers, filters unknown commands, and caches command fields', async () => {
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'quality review',
      skills: [{ name: 'tdd-workflow', confidence: 0.82, reason: 'tests' }],
      commands: [
        { name: 'quality-gate', confidence: 0.93, reason: 'quality gate' },
        { name: 'code-review', confidence: 0.78, reason: 'review' },
        { name: 'unknown-command', confidence: 0.99, reason: 'not available' },
      ],
    });

    const result = await analyzeIntent(
      'Please run testing and the quality gate review workflow for this change',
      skills,
      commands
    );

    expect(result.requiredCommands).toEqual(['quality-gate']);
    expect(result.suggestedCommands).toEqual(['code-review']);
    expect(result.commandScores).toEqual({
      'quality-gate': 0.93,
      'code-review': 0.78,
    });
    expect(mocks.callAIForIntentAnalysis).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.not.objectContaining({
        unrelated: expect.any(Object),
      })
    );
    expect(mocks.writeCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        requiredCommands: ['quality-gate'],
        suggestedCommands: ['code-review'],
        commandScores: {
          'quality-gate': 0.93,
          'code-review': 0.78,
        },
      })
    );
  });

  it('falls back to suggested command references when AI analysis fails', async () => {
    mocks.callAIForIntentAnalysis.mockRejectedValue(new Error('provider unavailable'));

    const result = await analyzeIntent(
      'Please run the quality gate workflow and draft a prp plan for this implementation',
      skills,
      commands
    );

    expect(result.requiredCommands).toEqual([]);
    expect(result.suggestedCommands).toEqual(['quality-gate', 'prp.plan']);
    expect(result.suggestedCommands).not.toContain('template-only');
  });

  it('uses command prompt triggers for AI candidate selection like skills', async () => {
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'security implementation',
      skills: [],
      commands: [{ name: 'security', confidence: 0.91, reason: 'security workflow' }],
    });

    const result = await analyzeIntent(
      'Generate a dependency security report for this implementation',
      {},
      {
        security: {
          description: 'Run comprehensive security review',
          template: 'Security body',
          promptTriggers: { keywords: ['security'] },
          source: 'config',
        },
        docs: {
          description: 'Write product documentation',
          template: 'Docs body',
          source: 'config',
        },
      }
    );

    expect(mocks.callAIForIntentAnalysis).toHaveBeenCalledWith(
      expect.any(String),
      {},
      {
        security: expect.objectContaining({
          description: 'Run comprehensive security review',
        }),
      }
    );
    expect(result.requiredCommands).toEqual(['security']);
  });
});

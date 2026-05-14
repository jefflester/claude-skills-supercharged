import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAIForIntentAnalysis: vi.fn(),
  getModel: vi.fn(),
  getProvider: vi.fn(),
  isPersistentCacheEnabled: vi.fn(),
  readCache: vi.fn(),
  writeCache: vi.fn(),
}));

vi.mock('../ai-client.js', () => ({
  callAIForIntentAnalysis: mocks.callAIForIntentAnalysis,
  getModel: mocks.getModel,
  getProvider: mocks.getProvider,
}));

vi.mock('../cache-manager.js', () => ({
  isPersistentCacheEnabled: mocks.isPersistentCacheEnabled,
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
    workflowPhase: 'Code Review',
    summary: 'Run checks and review gates.',
    template: 'Quality body',
    promptTriggers: { keywords: ['quality', 'gate'] },
    source: 'markdown',
  },
  'code-review': {
    description: 'Review code changes',
    workflowPhase: 'Code Review',
    summary: 'Validate changed files and risks.',
    template: 'Review body',
    source: 'markdown',
  },
  'template-only': {
    description: 'No keyword match',
    summary: 'No semantic overlap with user prompt.',
    template: 'Contains unique-template-token',
    source: 'markdown',
  },
  'prp.plan': {
    description: 'Create PRP plan',
    workflowPhase: 'Planning & Architecture',
    summary: 'Build a PRP implementation plan.',
    template: 'Unused in metadata fallback',
    promptTriggers: { keywords: ['prp', 'plan'] },
    source: 'markdown',
  },
  unrelated: {
    description: 'Publish a social media post',
    summary: 'Unrelated to code review and testing.',
    template: 'Unused unrelated command',
    source: 'markdown',
  },
};

describe('command-aware intent analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProvider.mockReturnValue('anthropic');
    mocks.getModel.mockReturnValue('claude-haiku-4-5');
    mocks.isPersistentCacheEnabled.mockReturnValue(false);
    mocks.readCache.mockReturnValue(null);
  });

  afterEach(() => {
    delete process.env.SKILL_CONFIDENCE_THRESHOLD;
    delete process.env.SKILL_SUGGESTED_THRESHOLD;
    delete process.env.COMMAND_CONFIDENCE_THRESHOLD;
    delete process.env.COMMAND_SUGGESTED_THRESHOLD;
    delete process.env.OPENCODE_SKILLS_PROMPT_TEMPLATE;
  });

  it('returns categorized command tiers, filters unknown commands, and caches command fields', async () => {
    mocks.isPersistentCacheEnabled.mockReturnValue(true);
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
      expect.objectContaining({
        'quality-gate': expect.any(Object),
        'code-review': expect.any(Object),
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

  it('does not read or write the persistent intent cache unless explicitly enabled', async () => {
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'quality review',
      skills: [],
      commands: [{ name: 'quality-gate', confidence: 0.95, reason: 'quality workflow' }],
    });

    const result = await analyzeIntent(
      'Please run the quality gate review workflow for this change',
      skills,
      commands
    );

    expect(result.fromCache).toBeUndefined();
    expect(mocks.readCache).not.toHaveBeenCalled();
    expect(mocks.writeCache).not.toHaveBeenCalled();
    expect(mocks.callAIForIntentAnalysis).toHaveBeenCalledOnce();
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

  it('passes the full command map to AI intent analysis', async () => {
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
          workflowPhase: 'Code Review',
          summary: 'Inspect auth and secret handling.',
          template: 'Security body',
          promptTriggers: { keywords: ['security'] },
          source: 'config',
        },
        docs: {
          description: 'Write product documentation',
          workflowPhase: 'Docs & Research',
          summary: 'Write docs only.',
          template: 'Docs body',
          source: 'config',
        },
      }
    );

    const aiCall = mocks.callAIForIntentAnalysis.mock.calls[0];
    const passedCommands = aiCall?.[2] as Record<string, CommandRule>;
    expect(Object.keys(passedCommands).sort()).toEqual(['docs', 'security']);
    expect(passedCommands.security).toMatchObject({
      description: 'Run comprehensive security review',
    });
    expect(passedCommands.docs).toMatchObject({
      description: 'Write product documentation',
    });
    expect(result.requiredCommands).toEqual(['security']);
  });

  it('changes cache key when command summary metadata changes', async () => {
    mocks.isPersistentCacheEnabled.mockReturnValue(true);
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'quality review',
      skills: [],
      commands: [{ name: 'quality-gate', confidence: 0.95, reason: 'quality workflow' }],
    });

    await analyzeIntent('Run quality review checks for this change request', {}, {
      'quality-gate': {
        description: 'Run quality review checks',
        workflowPhase: 'Code Review',
        summary: 'First summary variant.',
        template: 'Quality body',
        source: 'config',
      },
    });
    await analyzeIntent('Run quality review checks for this change request', {}, {
      'quality-gate': {
        description: 'Run quality review checks',
        workflowPhase: 'Code Review',
        summary: 'Updated summary variant.',
        template: 'Quality body',
        source: 'config',
      },
    });

    const firstCacheKey = mocks.readCache.mock.calls[0]?.[0];
    const secondCacheKey = mocks.readCache.mock.calls[1]?.[0];
    expect(firstCacheKey).toBeDefined();
    expect(secondCacheKey).toBeDefined();
    expect(firstCacheKey).not.toEqual(secondCacheKey);
  });

  it('changes cache key when provider, model, thresholds, or prompt template change', async () => {
    mocks.isPersistentCacheEnabled.mockReturnValue(true);
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'quality review',
      skills: [],
      commands: [{ name: 'quality-gate', confidence: 0.95, reason: 'quality workflow' }],
    });

    mocks.getProvider.mockReturnValue('anthropic');
    mocks.getModel.mockReturnValue('claude-haiku-4-5');
    process.env.SKILL_CONFIDENCE_THRESHOLD = '0.65';
    process.env.SKILL_SUGGESTED_THRESHOLD = '0.50';
    process.env.COMMAND_CONFIDENCE_THRESHOLD = '0.90';
    process.env.COMMAND_SUGGESTED_THRESHOLD = '0.70';
    process.env.OPENCODE_SKILLS_PROMPT_TEMPLATE = 'template-a';
    await analyzeIntent('Run quality review checks for this change request', {}, commands);

    mocks.getProvider.mockReturnValue('openai');
    mocks.getModel.mockReturnValue('gpt-4o-mini');
    process.env.SKILL_CONFIDENCE_THRESHOLD = '0.75';
    process.env.SKILL_SUGGESTED_THRESHOLD = '0.55';
    process.env.COMMAND_CONFIDENCE_THRESHOLD = '0.85';
    process.env.COMMAND_SUGGESTED_THRESHOLD = '0.65';
    process.env.OPENCODE_SKILLS_PROMPT_TEMPLATE = 'template-b';
    await analyzeIntent('Run quality review checks for this change request', {}, commands);

    delete process.env.SKILL_CONFIDENCE_THRESHOLD;
    delete process.env.SKILL_SUGGESTED_THRESHOLD;
    delete process.env.COMMAND_CONFIDENCE_THRESHOLD;
    delete process.env.COMMAND_SUGGESTED_THRESHOLD;
    delete process.env.OPENCODE_SKILLS_PROMPT_TEMPLATE;

    const firstCacheKey = mocks.readCache.mock.calls[0]?.[0];
    const secondCacheKey = mocks.readCache.mock.calls[1]?.[0];
    expect(firstCacheKey).toBeDefined();
    expect(secondCacheKey).toBeDefined();
    expect(firstCacheKey).not.toEqual(secondCacheKey);
  });

  it('calls AI with full skill and command maps even without local keyword overlap', async () => {
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'security analysis',
      skills: [],
      commands: [{ name: 'audit-helper', confidence: 0.88, reason: 'summary match' }],
    });

    await analyzeIntent(
      'Coordinate quarterly roadmap staffing and release planning milestones across product teams',
      {
        'tdd-workflow': {
          type: 'domain',
          description: 'Testing workflow',
          promptTriggers: { keywords: ['test', 'testing'] },
        },
      },
      {
        'audit-helper': {
          description: 'Helper command',
          workflowPhase: 'Code Review',
          summary: 'Generate dependency security report with vulnerability findings.',
          template: 'Audit body',
          source: 'config',
        },
        unrelated: {
          description: 'Generic helper command',
          summary: 'Format markdown headings.',
          template: 'Unrelated body',
          source: 'config',
        },
      }
    );

    expect(mocks.callAIForIntentAnalysis).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        'tdd-workflow': expect.any(Object),
      }),
      {
        'audit-helper': expect.objectContaining({
          summary: 'Generate dependency security report with vulnerability findings.',
        }),
        unrelated: expect.objectContaining({
          description: 'Generic helper command',
        }),
      }
    );
  });

  it('does not inject commands from regex shortcuts when AI returns no commands', async () => {
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'security implementation',
      skills: [],
      commands: [],
    });

    const result = await analyzeIntent(
      'Build a TypeScript MCP workflow and include dependency security checks and auth validation',
      {},
      {
        security: {
          description: 'Run comprehensive security checks',
          workflowPhase: 'Code Review',
          summary: 'Validate authentication and dependency vulnerabilities.',
          template: 'Security body',
          source: 'config',
        },
        'python-review': {
          description: 'Review Python code',
          workflowPhase: 'Code Review',
          summary: 'Includes security validation for python projects.',
          template: 'Python body',
          source: 'config',
        },
        'add-language-rules': {
          description: 'Configure project language rules',
          workflowPhase: 'Project & Infrastructure',
          summary: 'Adds setup guidance and security defaults.',
          template: 'Rules body',
          source: 'config',
        },
      }
    );

    // With no AI-sourced commands, all command lists are empty.
    // Regex shortcuts have been removed — command routing is AI-only.
    expect(result.requiredCommands).toEqual([]);
    expect(result.suggestedCommands).toEqual([]);
    expect(result.requiredCommands).not.toContain('python-review');
    expect(result.requiredCommands).not.toContain('add-language-rules');
  });

  it('uses full command metadata fallback for short prompts', async () => {
    const result = await analyzeIntent(
      'security dependency report',
      {},
      {
        'audit-helper': {
          description: 'Helper command',
          workflowPhase: 'Code Review',
          summary: 'Generate dependency security report with vulnerability findings.',
          template: 'Audit body',
          source: 'config',
        },
        docs: {
          description: 'Documentation helper',
          summary: 'Format documentation headings and sections.',
          template: 'Docs body',
          source: 'config',
        },
      }
    );

    expect(mocks.callAIForIntentAnalysis).not.toHaveBeenCalled();
    expect(result.requiredCommands).toEqual([]);
    expect(result.suggestedCommands).toContain('audit-helper');
    expect(result.suggestedCommands).not.toContain('docs');
  });

  it('does not suggest scored domain commands in short-prompt fallback when domain fallback mode is off', async () => {
    const previousMode = process.env.OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE;
    process.env.OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE = 'off';
    vi.resetModules();

    try {
      const { analyzeIntent: analyzeIntentModeOff } = await import('../intent-analyzer.js');
      const result = await analyzeIntentModeOff(
        'security dependency report',
        {},
        {
          'audit-helper': {
            description: 'Helper command',
            workflowPhase: 'Code Review',
            summary: 'Generate dependency security report with vulnerability findings.',
            template: 'Audit body',
            source: 'config',
          },
          'guardrail-security': {
            description: 'Critical guardrail security checks',
            workflowPhase: 'Code Review',
            summary: 'Run mandatory dependency security validation.',
            template: 'Guardrail body',
            autoInject: true,
            source: 'config',
          },
        }
      );

      expect(result.suggestedCommands).not.toContain('audit-helper');
      expect(result.requiredCommands).toContain('guardrail-security');
    } finally {
      if (previousMode === undefined) {
        delete process.env.OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE;
      } else {
        process.env.OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE = previousMode;
      }
      vi.resetModules();
    }
  });

  it('returns empty result without calling AI when both full surfaces are empty', async () => {
    const result = await analyzeIntent(
      'This is a long prompt that should bypass short fallback but has no available surfaces to analyze',
      {},
      {}
    );

    expect(result).toEqual({ required: [], suggested: [], requiredCommands: [], suggestedCommands: [], commandScores: {} });
    expect(mocks.callAIForIntentAnalysis).not.toHaveBeenCalled();
  });

  it('filters unknown skill and command names returned by the model against full availability maps', async () => {
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'quality review',
      skills: [
        { name: 'tdd-workflow', confidence: 0.8, reason: 'tests' },
        { name: 'unknown-skill', confidence: 0.99, reason: 'hallucinated' },
      ],
      commands: [
        { name: 'quality-gate', confidence: 0.92, reason: 'quality gate' },
        { name: 'unknown-command', confidence: 0.99, reason: 'hallucinated' },
      ],
    });

    const result = await analyzeIntent(
      'Please run testing and the quality gate workflow across the changed files in this branch',
      skills,
      commands
    );

    expect(result.required).toContain('tdd-workflow');
    expect(result.required).not.toContain('unknown-skill');
    expect(result.requiredCommands).toContain('quality-gate');
    expect(result.requiredCommands).not.toContain('unknown-command');
    expect(result.commandScores).not.toHaveProperty('unknown-command');
  });
});

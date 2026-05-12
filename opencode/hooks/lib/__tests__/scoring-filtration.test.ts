import { existsSync, readFileSync } from 'fs';
import { describe, it, expect, vi } from 'vitest';

// Mock all external modules before importing our modules
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock AI provider modules
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ text: '{"primary_intent": "test", "skills": []}' }]
      })
    }
  }))
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: '{"primary_intent": "test", "skills": []}'
            }
          }]
        })
      }
    }
  }))
}));

// Global fetch mock for Ollama
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { matchSkillsByKeywords } from '../keyword-matcher.js';
import { CONFIDENCE_THRESHOLD, SUGGESTED_THRESHOLD } from '../constants.js';
import { buildAnalysisResult, categorizeSkills } from '../intent-scorer.js';
import { resolveSkillDependencies } from '../skill-resolution.js';
import {
  applyInjectionLimits,
  filterAndPromoteSkills,
  filterUnacknowledgedSkills,
  findAffinityInjections,
} from '../skill-filtration.js';
import {
  formatActivationBanner,
  formatAlreadyLoadedSection,
  formatClosingBanner,
  formatJustInjectedSection,
  formatRecommendedSection,
  injectSkillContent,
} from '../output-formatter.js';
import { getProvider, getModel, parseIntentAnalysis, buildPrompt, callAIForIntentAnalysis } from '../ai-client.js';
import { analyzeIntent } from '../intent-analyzer.js';
import type { AnalysisResult, IntentAnalysis, SkillRule } from '../types.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

const mockSkillRules: Record<string, SkillRule> = {
  'guardrail-a': { type: 'guardrail' },
  'guardrail-b': { type: 'guardrail' },
  'domain-a': { type: 'domain' },
  'domain-b': { type: 'domain' },
  'domain-c': { type: 'domain' },
  'domain-d': { type: 'domain' },
  'frontend-framework': {
    type: 'domain',
    affinity: ['system-architecture', 'api-protocols', 'extra-affinity'],
  },
  'system-architecture': {
    type: 'domain',
    affinity: ['frontend-framework'],
  },
  'design-system': {
    type: 'domain',
    affinity: ['frontend-framework'],
  },
  'api-protocols': { type: 'domain' },
  'extra-affinity': { type: 'domain' },
  root: { type: 'domain', requiredSkills: ['child'], injectionOrder: 20 },
  child: { type: 'domain', injectionOrder: 10 },
  later: { type: 'domain', injectionOrder: 80 },
  'default-order': { type: 'domain' },
  'cycle-a': { type: 'domain', requiredSkills: ['cycle-b'], injectionOrder: 5 },
  'cycle-b': { type: 'domain', requiredSkills: ['cycle-a'], injectionOrder: 6 },
};

// Sample intent analysis for testing
const sampleIntentAnalysis: IntentAnalysis = {
  primary_intent: 'build an api',
  skills: [
    { name: 'api-design', confidence: 0.9, reason: 'API mentioned' },
    { name: 'security-review', confidence: 0.8, reason: 'Authentication mentioned' }
  ]
};

describe('matchSkillsByKeywords', () => {
  it('matches keywords case-insensitively and puts domain skills in suggested by default', () => {
    const result = matchSkillsByKeywords('Fix AUTH and cache logic', {
      auth: { type: 'domain', promptTriggers: { keywords: ['auth'] } },
      cache: { type: 'domain', promptTriggers: { keywords: ['cache'] }, autoInject: false },
      logs: { type: 'domain', promptTriggers: { keywords: ['logs'] } },
    });

    // Default FALLBACK_DOMAIN_MODE is 'suggest' — domain skills go to suggested
    expect(result.required).toEqual([]);
    expect(result.suggested).toEqual(['auth', 'cache']);
  });

  it('returns only detected skills in insertion order with suggested default', () => {
    const result = matchSkillsByKeywords('service and api update', {
      service: { type: 'domain', promptTriggers: { keywords: ['service'] } },
      api: { type: 'domain', promptTriggers: { keywords: ['api'] } },
      ignored: { type: 'domain' },
    });

    // Default mode puts domain skills in suggested
    expect(result.required).toEqual([]);
    expect(result.suggested).toEqual(['service', 'api']);
  });

  it('puts guardrail skills (autoInject: true) in required regardless of mode', () => {
    const result = matchSkillsByKeywords('auth service', {
      auth: { type: 'guardrail', promptTriggers: { keywords: ['auth'] }, autoInject: true },
      service: { type: 'domain', promptTriggers: { keywords: ['service'] } },
    });

    expect(result.required).toEqual(['auth']);
    expect(result.suggested).toEqual(['service']);
  });
});

describe('intent-scorer', () => {
  it('categorizes required and suggested skills by confidence', () => {
    const analysis: IntentAnalysis = {
      primary_intent: 'build an api',
      skills: [
        { name: 'low', confidence: SUGGESTED_THRESHOLD - 0.1, reason: 'low' },
        { name: 'required-high', confidence: CONFIDENCE_THRESHOLD + 0.1, reason: 'high' },
        { name: 'suggested-mid', confidence: SUGGESTED_THRESHOLD + 0.1, reason: 'mid' },
      ],
    };

    expect(categorizeSkills(analysis)).toEqual({
      required: ['required-high'],
      suggested: ['suggested-mid'],
    });
  });

  it('limits and sorts categorized skills', () => {
    const analysis: IntentAnalysis = {
      primary_intent: 'refactor',
      skills: [
        { name: 'required-low', confidence: CONFIDENCE_THRESHOLD + 0.01, reason: 'first' },
        { name: 'required-high', confidence: CONFIDENCE_THRESHOLD + 0.2, reason: 'second' },
        { name: 'required-third', confidence: CONFIDENCE_THRESHOLD + 0.25, reason: 'third' },
        { name: 'suggested-low', confidence: SUGGESTED_THRESHOLD, reason: 'low' },
        { name: 'suggested-high', confidence: CONFIDENCE_THRESHOLD, reason: 'high' },
        { name: 'suggested-third', confidence: SUGGESTED_THRESHOLD + 0.05, reason: 'third' },
      ],
    };

    expect(categorizeSkills(analysis)).toEqual({
      required: ['required-third', 'required-high'],
      suggested: ['suggested-high', 'suggested-third'],
    });
  });

  it('returns empty tiers for malformed analysis', () => {
    expect(categorizeSkills({ primary_intent: 'x', skills: undefined as never })).toEqual({
      required: [],
      suggested: [],
    });
  });

  it('builds analysis results with optional score maps', () => {
    const categorized: AnalysisResult = { required: ['required-high'], suggested: ['suggested-mid'] };
    const analysis: IntentAnalysis = {
      primary_intent: 'build',
      skills: [
        { name: 'required-high', confidence: 0.9, reason: 'high' },
        { name: 'suggested-mid', confidence: 0.6, reason: 'mid' },
      ],
    };

    expect(buildAnalysisResult(categorized, analysis, false)).toEqual(categorized);
    expect(buildAnalysisResult(categorized, analysis, true)).toEqual({
      required: ['required-high'],
      suggested: ['suggested-mid'],
      scores: {
        'required-high': 0.9,
        'suggested-mid': 0.6,
      },
    });
  });
});

describe('skill-resolution', () => {
  it('resolves dependencies before root skills and respects injection order', () => {
    expect(resolveSkillDependencies(['root', 'later'], mockSkillRules)).toEqual([
      'child',
      'root',
      'later',
    ]);
  });

  it('logs missing and circular dependency errors without throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(resolveSkillDependencies(['missing', 'cycle-a'], mockSkillRules)).toEqual(['cycle-a', 'cycle-b']);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('skill-filtration', () => {
  it('filters acknowledged skills', () => {
    expect(filterUnacknowledgedSkills(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });

  it('applies injection limits with guardrails exempt from the cap', () => {
    expect(
      applyInjectionLimits(['guardrail-a', 'domain-a'], ['domain-b', 'domain-c'], 0, mockSkillRules)
    ).toEqual({
      toInject: ['guardrail-a', 'domain-a', 'domain-b'],
      promoted: ['domain-b'],
      remainingSuggested: ['domain-c'],
    });
  });

  it('finds affinity injections in both directions and ignores acknowledged skills', () => {
    expect(
      findAffinityInjections(['frontend-framework'], ['system-architecture'], mockSkillRules)
    ).toEqual(['api-protocols', 'design-system']);
  });

  it('filters, promotes, and preserves guardrail slots', () => {
    expect(
      filterAndPromoteSkills(['guardrail-a', 'domain-a'], ['domain-b'], ['guardrail-a'], mockSkillRules)
    ).toEqual({
      toInject: ['domain-a', 'domain-b'],
      promoted: ['domain-b'],
      remainingSuggested: [],
    });
  });
});

describe('output-formatter', () => {
  it('injects skill content when files exist', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('## Skill Content');

    const output = injectSkillContent(['skill-a'], 'C:\\project');

    expect(output).toContain('📚 AUTO-LOADED SKILLS');
    expect(output).toContain('<skill name="skill-a">');
    expect(output).toContain('## Skill Content');
    expect(output).toContain('Loaded 1 skill(s): skill-a');
  });

  it('returns an empty string when no skills are injected', () => {
    expect(injectSkillContent([], 'C:\\project')).toBe('');
  });

  it('formats activation, loaded, recommended, and closing sections', () => {
    expect(formatActivationBanner()).toBe(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎯 SKILL ACTIVATION CHECK\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
    );
    expect(formatJustInjectedSection(['a', 'b', 'c'], ['c'], ['a'], ['b'])).toBe(
      '\n📚 JUST LOADED:\n  → a (affinity)\n  → b (promoted)\n  → c (critical)\n'
    );
    expect(formatAlreadyLoadedSection(['x', 'y'])).toBe('\n✓ ALREADY LOADED:\n  → x\n  → y\n');
    expect(formatRecommendedSection(['r1', 'r2'], { r1: 0.6, r2: 0.5 })).toBe(
      '\n📚 RECOMMENDED SKILLS (not auto-loaded):\n  → r1 (0.60)\n  → r2 (0.50)\n\nOptional: Use Skill tool to load if needed\n'
    );
    expect(formatClosingBanner()).toBe('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
});

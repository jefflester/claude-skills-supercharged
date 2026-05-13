import { describe, expect, it } from 'vitest';
import { categorizeCommands } from '../intent-scorer.js';
import {
  filterCommandReferences,
  filterUnacknowledgedCommands,
  resolveCommandDependencies,
} from '../command-filtration.js';
import type { CommandRule, IntentAnalysis } from '../types.js';

describe('command scoring and filtration', () => {
  it('categorizes command confidence using 0.90 required and 0.70 suggested thresholds', () => {
    const analysis: IntentAnalysis = {
      primary_intent: 'review code',
      skills: [],
      commands: [
        { name: 'required-boundary', confidence: 0.9, reason: 'exactly required' },
        { name: 'suggested-high', confidence: 0.89, reason: 'below required' },
        { name: 'suggested-boundary', confidence: 0.7, reason: 'exactly suggested' },
        { name: 'ignored', confidence: 0.69, reason: 'too low' },
      ],
    };

    expect(categorizeCommands(analysis)).toEqual({
      required: ['required-boundary'],
      suggested: ['suggested-high', 'suggested-boundary'],
    });
  });

  it('sorts and caps required and suggested commands independently', () => {
    const analysis: IntentAnalysis = {
      primary_intent: 'quality pass',
      skills: [],
      commands: [
        { name: 'required-low', confidence: 0.91, reason: 'low' },
        { name: 'required-high', confidence: 0.99, reason: 'high' },
        { name: 'required-mid', confidence: 0.95, reason: 'mid' },
        { name: 'suggested-low', confidence: 0.71, reason: 'low' },
        { name: 'suggested-high', confidence: 0.89, reason: 'high' },
        { name: 'suggested-mid', confidence: 0.8, reason: 'mid' },
      ],
    };

    expect(categorizeCommands(analysis)).toEqual({
      required: ['required-high', 'required-mid', 'required-low'],
      suggested: ['suggested-high', 'suggested-mid', 'suggested-low'],
    });
  });

  const commandRules: Record<string, CommandRule> = {
    'quality-gate': { template: 'body', source: 'markdown' },
    'code-review': { template: 'body', source: 'markdown' },
    'plankton-code-quality': { template: 'body', source: 'markdown' },
    'security-review': { template: 'body', source: 'markdown' },
  };

  it('filters acknowledged commands without promoting suggested commands into required slots', () => {
    expect(filterUnacknowledgedCommands(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);

    expect(
      filterCommandReferences(
        ['quality-gate', 'code-review'],
        ['plankton-code-quality', 'security-review'],
        ['code-review', 'security-review'],
        commandRules
      )
    ).toEqual({
      toInject: ['quality-gate'],
      promoted: [],
      remainingSuggested: ['plankton-code-quality'],
    });
  });

  it('keeps command guardrails exempt from the domain command cap', () => {
    const rules: Record<string, CommandRule> = {
      guardrail: { type: 'guardrail', template: 'body', source: 'markdown' },
      a: { template: 'body', source: 'markdown' },
      b: { template: 'body', source: 'markdown' },
      c: { template: 'body', source: 'markdown' },
      d: { template: 'body', source: 'markdown' },
      e: { template: 'body', source: 'markdown' },
      f: { template: 'body', source: 'markdown' },
    };

    expect(
      filterCommandReferences(['guardrail', 'a', 'b', 'c', 'd', 'e', 'f'], [], [], rules)
        .toInject
    ).toEqual(['guardrail', 'a', 'b', 'c', 'd', 'e']);
  });

  it('keeps suggested guardrail commands suggested', () => {
    const rules: Record<string, CommandRule> = {
      guardrail: { type: 'guardrail', template: 'body', source: 'markdown' },
      domain: { template: 'body', source: 'markdown' },
    };

    expect(filterCommandReferences([], ['guardrail', 'domain'], [], rules)).toEqual({
      toInject: [],
      promoted: [],
      remainingSuggested: ['guardrail', 'domain'],
    });
  });

  it('resolves command dependencies and sorts by injection order', () => {
    const rules: Record<string, CommandRule> = {
      root: {
        template: 'body',
        source: 'markdown',
        requiredCommands: ['dependency'],
        injectionOrder: 20,
      },
      dependency: { template: 'body', source: 'markdown', injectionOrder: 10 },
    };

    expect(resolveCommandDependencies(['root'], rules)).toEqual(['dependency', 'root']);
  });
});

import { describe, expect, it } from 'vitest';
import { categorizeCommands } from '../intent-scorer.js';
import {
  filterCommandReferences,
  filterUnacknowledgedCommands,
} from '../command-filtration.js';
import type { IntentAnalysis } from '../types.js';

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

  it('filters acknowledged commands without promotion', () => {
    expect(filterUnacknowledgedCommands(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);

    expect(
      filterCommandReferences(
        ['quality-gate', 'code-review'],
        ['plankton-code-quality', 'security-review'],
        ['code-review', 'security-review']
      )
    ).toEqual({
      toInject: ['quality-gate'],
      remainingSuggested: ['plankton-code-quality'],
    });
  });
});

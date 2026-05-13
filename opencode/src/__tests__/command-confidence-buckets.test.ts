import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCommandConfidenceBuckets as buildCliCommandConfidenceBuckets,
} from '../cli.js';
import {
  buildCommandConfidenceBuckets as buildMcpCommandConfidenceBuckets,
} from '../mcp-server.js';
import type { AnalysisResult } from '../../hooks/lib/types.js';

const originalRequiredThreshold = process.env.COMMAND_CONFIDENCE_THRESHOLD;
const originalSuggestedThreshold = process.env.COMMAND_SUGGESTED_THRESHOLD;

afterEach(() => {
  if (originalRequiredThreshold === undefined) {
    delete process.env.COMMAND_CONFIDENCE_THRESHOLD;
  } else {
    process.env.COMMAND_CONFIDENCE_THRESHOLD = originalRequiredThreshold;
  }

  if (originalSuggestedThreshold === undefined) {
    delete process.env.COMMAND_SUGGESTED_THRESHOLD;
  } else {
    process.env.COMMAND_SUGGESTED_THRESHOLD = originalSuggestedThreshold;
  }
});

const analysis: AnalysisResult = {
  required: [],
  suggested: [],
  requiredCommands: [],
  suggestedCommands: [],
  commandScores: {
    'required-1': 0.99,
    'required-2': 0.98,
    'required-3': 0.97,
    'required-4': 0.96,
    'required-5': 0.95,
    'required-6': 0.94,
    'suggested-1': 0.89,
    'suggested-2': 0.88,
    'suggested-3': 0.87,
    'suggested-4': 0.86,
    'suggested-5': 0.85,
    'suggested-6': 0.84,
  },
};

describe('command confidence buckets', () => {
  it('caps CLI required and suggested commands as maximums', () => {
    const result = buildCliCommandConfidenceBuckets(analysis, 0.9);

    expect(result.required).toEqual([
      'required-1',
      'required-2',
      'required-3',
      'required-4',
      'required-5',
    ]);
    expect(result.suggested).toEqual([
      'suggested-1',
      'suggested-2',
      'suggested-3',
      'suggested-4',
      'suggested-5',
    ]);
  });

  it('caps MCP required and suggested commands as maximums', () => {
    const result = buildMcpCommandConfidenceBuckets(analysis, 0.9);

    expect(result.required).toEqual([
      'required-1',
      'required-2',
      'required-3',
      'required-4',
      'required-5',
    ]);
    expect(result.suggested).toEqual([
      'suggested-1',
      'suggested-2',
      'suggested-3',
      'suggested-4',
      'suggested-5',
    ]);
  });
});

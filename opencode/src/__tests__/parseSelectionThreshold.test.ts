import { describe, it, expect, afterEach } from 'vitest';
import { parseNumberOption, parseSelectionThreshold } from '../../src/cli.js';

describe('parseSelectionThreshold behavior', () => {
  const originalEnv = process.env.SKILL_CONFIDENCE_THRESHOLD;

  afterEach(() => {
    // Restore environment variable
    if (originalEnv !== undefined) {
      process.env.SKILL_CONFIDENCE_THRESHOLD = originalEnv;
    } else {
      delete process.env.SKILL_CONFIDENCE_THRESHOLD;
    }
  });

  it('prioritizes optionThreshold when it is a finite number', () => {
    const result = parseSelectionThreshold(0.8);
    expect(result).toBe(0.8);
  });

  it('uses SKILL_CONFIDENCE_THRESHOLD environment variable when optionThreshold is undefined', () => {
    process.env.SKILL_CONFIDENCE_THRESHOLD = '0.75';
    const result = parseSelectionThreshold(undefined);
    expect(result).toBe(0.75);
  });

  it('uses default threshold of 0.65 when no environment variable is set and optionThreshold is undefined', () => {
    delete process.env.SKILL_CONFIDENCE_THRESHOLD;
    const result = parseSelectionThreshold(undefined);
    expect(result).toBe(0.65);
  });

  it('uses default threshold of 0.65 when environment variable is invalid', () => {
    process.env.SKILL_CONFIDENCE_THRESHOLD = 'invalid';
    const result = parseSelectionThreshold(undefined);
    expect(result).toBe(0.65);
  });
});
import { describe, it, expect } from 'vitest';
import * as constants from '../constants';

describe('constants', () => {
  it('should have sensible confidence thresholds', () => {
    expect(constants.CONFIDENCE_THRESHOLD).toBeGreaterThan(constants.SUGGESTED_THRESHOLD);
    expect(constants.CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1.0);
    expect(constants.SUGGESTED_THRESHOLD).toBeGreaterThanOrEqual(0.0);
  });

  it('should limit skill injection counts', () => {
    expect(constants.MAX_REQUIRED_SKILLS).toBeGreaterThan(0);
    expect(constants.MAX_SUGGESTED_SKILLS).toBeGreaterThan(0);
  });

  it('should have reasonable cache TTL', () => {
    expect(constants.CACHE_TTL_MS).toBeGreaterThan(0);
    expect(constants.CACHE_CLEANUP_AGE_MS).toBeGreaterThan(constants.CACHE_TTL_MS);
  });

  it('should have short prompt threshold for keyword fallback', () => {
    expect(constants.SHORT_PROMPT_WORD_THRESHOLD).toBeGreaterThan(0);
    expect(constants.SHORT_PROMPT_WORD_THRESHOLD).toBeLessThan(50);
  });

  it('should have default injection order in valid range', () => {
    expect(constants.DEFAULT_INJECTION_ORDER).toBeGreaterThanOrEqual(0);
    expect(constants.DEFAULT_INJECTION_ORDER).toBeLessThanOrEqual(100);
  });
});

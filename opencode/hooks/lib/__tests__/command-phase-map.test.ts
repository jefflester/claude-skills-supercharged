import { describe, expect, it } from 'vitest';
import { getWorkflowPhaseForCommand } from '../command-phase-map.js';

describe('command workflow phase map', () => {
  it('maps canonical commands to workflow phases', () => {
    expect(getWorkflowPhaseForCommand('quality-gate')).toBe('Code Review');
    expect(getWorkflowPhaseForCommand('/verify')).toBe('Testing');
    expect(getWorkflowPhaseForCommand('prp-plan')).toBe('Planning & Architecture');
  });

  it('does not map removed commands/* aliases', () => {
    expect(getWorkflowPhaseForCommand('commands/verify')).toBeUndefined();
    expect(getWorkflowPhaseForCommand('/commands/tdd')).toBeUndefined();
  });
});


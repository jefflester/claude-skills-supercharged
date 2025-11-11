import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  injectSkillContent,
  formatActivationBanner,
  formatAlreadyLoadedSection,
  formatRecommendedSection,
  formatClosingBanner,
} from '../output-formatter.js';

/**
 * Tests for output formatting functions
 *
 * Validates banner generation, skill content injection, and section formatting
 * for the skill activation hook display output.
 */

describe('Output Formatter', () => {
  let testProjectDir: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    testProjectDir = join(tmpdir(), `output-formatter-test-${Date.now()}-${Math.random()}`);
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testProjectDir)) {
      rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('injectSkillContent', () => {
    it('should read skills and format with XML tags', () => {
      // Setup test skill files
      const skillsDir = join(testProjectDir, '.claude', 'skills');
      mkdirSync(join(skillsDir, 'test-skill'), { recursive: true });
      writeFileSync(
        join(skillsDir, 'test-skill', 'SKILL.md'),
        '# Test Skill\n\nThis is a test skill.'
      );

      const output = injectSkillContent(['test-skill'], testProjectDir);

      expect(output).toContain('📚 AUTO-LOADED SKILLS');
      expect(output).toContain('<skill name="test-skill">');
      expect(output).toContain('# Test Skill');
      expect(output).toContain('This is a test skill.');
      expect(output).toContain('</skill>');
      expect(output).toContain('Loaded 1 skill(s): test-skill');
    });

    it('should handle missing skill files gracefully', () => {
      // Don't create any skill files
      const output = injectSkillContent(['non-existent-skill'], testProjectDir);

      // Should still output banner but warn about missing file
      expect(output).toContain('📚 AUTO-LOADED SKILLS');
      expect(output).toContain('Loaded 1 skill(s): non-existent-skill');
      // Should not contain skill content tags
      expect(output).not.toContain('<skill name="non-existent-skill">');
    });

    it('should return empty string for empty skill array', () => {
      const output = injectSkillContent([], testProjectDir);

      expect(output).toBe('');
    });

    it('should format multiple skills correctly', () => {
      const skillsDir = join(testProjectDir, '.claude', 'skills');
      mkdirSync(join(skillsDir, 'skill-1'), { recursive: true });
      mkdirSync(join(skillsDir, 'skill-2'), { recursive: true });
      writeFileSync(join(skillsDir, 'skill-1', 'SKILL.md'), 'Skill 1 content');
      writeFileSync(join(skillsDir, 'skill-2', 'SKILL.md'), 'Skill 2 content');

      const output = injectSkillContent(['skill-1', 'skill-2'], testProjectDir);

      expect(output).toContain('<skill name="skill-1">');
      expect(output).toContain('Skill 1 content');
      expect(output).toContain('</skill>');
      expect(output).toContain('<skill name="skill-2">');
      expect(output).toContain('Skill 2 content');
      expect(output).toContain('Loaded 2 skill(s): skill-1, skill-2');
    });

    it('should handle file read errors gracefully', () => {
      // Create directory but no file (will trigger file read error)
      const skillsDir = join(testProjectDir, '.claude', 'skills');
      mkdirSync(join(skillsDir, 'broken-skill'), { recursive: true });
      // Don't create SKILL.md file

      const output = injectSkillContent(['broken-skill'], testProjectDir);

      // Should complete without throwing
      expect(output).toContain('📚 AUTO-LOADED SKILLS');
    });
  });

  describe('formatActivationBanner', () => {
    it('should return expected banner format', () => {
      const banner = formatActivationBanner();

      expect(banner).toContain('🎯 SKILL ACTIVATION CHECK');
      expect(banner).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'); // 39 chars
      expect(banner).toMatch(/^━+\n/); // Starts with separator
      expect(banner).toMatch(/\n━+\n\n$/); // Ends with separator and newline
    });
  });

  describe('formatAlreadyLoadedSection', () => {
    it('should list previously loaded skills', () => {
      const alreadyLoaded = ['frontend-framework', 'testing-strategy'];

      const output = formatAlreadyLoadedSection(alreadyLoaded);

      expect(output).toContain('✓ ALREADY LOADED:');
      expect(output).toContain('→ frontend-framework');
      expect(output).toContain('→ testing-strategy');
    });

    it('should return empty string for empty array', () => {
      const output = formatAlreadyLoadedSection([]);

      expect(output).toBe('');
    });

    it('should format single skill', () => {
      const output = formatAlreadyLoadedSection(['single-skill']);

      expect(output).toContain('✓ ALREADY LOADED:');
      expect(output).toContain('→ single-skill');
    });
  });

  describe('formatRecommendedSection', () => {
    it('should show skills with confidence scores when provided', () => {
      const skills = ['skill-1', 'skill-2'];
      const scores = { 'skill-1': 0.55, 'skill-2': 0.62 };

      const output = formatRecommendedSection(skills, scores);

      expect(output).toContain('📚 RECOMMENDED SKILLS (not auto-loaded):');
      expect(output).toContain('→ skill-1 (0.55)');
      expect(output).toContain('→ skill-2 (0.62)');
      expect(output).toContain('Optional: Use Skill tool to load if needed');
    });

    it('should work without confidence scores', () => {
      const skills = ['skill-1', 'skill-2'];

      const output = formatRecommendedSection(skills);

      expect(output).toContain('📚 RECOMMENDED SKILLS (not auto-loaded):');
      expect(output).toContain('→ skill-1');
      expect(output).toContain('→ skill-2');
      expect(output).not.toContain('(0.');
      expect(output).toContain('Optional: Use Skill tool to load if needed');
    });

    it('should return empty string for empty array', () => {
      const output = formatRecommendedSection([]);

      expect(output).toBe('');
    });

    it('should handle partial score data gracefully', () => {
      const skills = ['skill-1', 'skill-2', 'skill-3'];
      const scores = { 'skill-1': 0.58, 'skill-3': 0.51 }; // Missing skill-2

      const output = formatRecommendedSection(skills, scores);

      expect(output).toContain('→ skill-1 (0.58)');
      expect(output).toContain('→ skill-2\n'); // No score
      expect(output).toContain('→ skill-3 (0.51)');
    });

    it('should format scores with 2 decimal places', () => {
      const skills = ['precise-skill'];
      const scores = { 'precise-skill': 0.5555555 };

      const output = formatRecommendedSection(skills, scores);

      expect(output).toContain('(0.56)'); // Rounded to 2 decimals
    });
  });

  describe('formatClosingBanner', () => {
    it('should return closing line separator', () => {
      const banner = formatClosingBanner();

      expect(banner).toBe('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      expect(banner.length).toBe(40); // 39 separator chars + newline
    });
  });
});

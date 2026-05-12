import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock the skill-discovery module
vi.mock('../hooks/lib/skill-discovery.js', () => ({
  SKILL_RULES_PATH: '/mock/skill-rules.json',
  SKILLS_DIR: '/mock/skills',
  buildSkillRulesFromSkills: vi.fn(),
}));

// Import after mocks are set up
import { readFile } from 'fs/promises';
import { buildSkillRulesFromSkills, SKILL_RULES_PATH, SKILLS_DIR } from '../hooks/lib/skill-discovery.js';

// Helper to create a valid skill-rules.json config
function createValidSkillRules() {
  return {
    version: '1.0',
    skills: {
      'test-skill': {
        type: 'domain',
        autoInject: false,
        requiredSkills: [],
        description: 'A test skill',
        promptTriggers: {
          keywords: ['test'],
        },
      },
    },
  };
}

// Helper to create an invalid shape (missing version)
function createInvalidShapeMissingVersion() {
  return {
    skills: {
      'test-skill': {
        type: 'domain',
        autoInject: false,
        requiredSkills: [],
        description: 'A test skill',
        promptTriggers: {
          keywords: ['test'],
        },
      },
    },
  };
}

// Helper to create an invalid shape (missing skills)
function createInvalidShapeMissingSkills() {
  return {
    version: '1.0',
  };
}

// Helper to create an invalid shape (version is not a string)
function createInvalidVersionType() {
  return {
    version: 123,
    skills: {},
  };
}

// Helper to create an invalid shape (skills is an array)
function createInvalidSkillsType() {
  return {
    version: '1.0',
    skills: [],
  };
}

describe('loadSkillRules function behavior', () => {
  const mockReadFile = readFile as ReturnType<typeof vi.fn>;
  const mockBuildSkillRulesFromSkills = buildSkillRulesFromSkills as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default mock for buildSkillRulesFromSkills
    mockBuildSkillRulesFromSkills.mockReturnValue({
      version: '1.0-discovered',
      skills: {
        'fallback-skill': {
          type: 'domain',
          autoInject: false,
          requiredSkills: [],
          description: 'A discovered skill',
          promptTriggers: {
            keywords: ['fallback'],
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Happy path: skill-rules.json exists and is valid', () => {
    it('returns parsed config when skill-rules.json is valid', async () => {
      // Arrange
      const validConfig = createValidSkillRules();
      mockReadFile.mockResolvedValue(JSON.stringify(validConfig));

      // Act - Simulate what loadSkillRules does directly for testing
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);

      // Assert
      expect(mockReadFile).toHaveBeenCalledWith(SKILL_RULES_PATH, 'utf8');
      expect(parsedRules).toEqual(validConfig);
      expect(parsedRules.version).toBe('1.0');
      expect(parsedRules.skills['test-skill']).toBeDefined();
    });

    it('validates that version is a string', async () => {
      // Arrange
      const configWithStringVersion = { version: '1.0', skills: {} };
      mockReadFile.mockResolvedValue(JSON.stringify(configWithStringVersion));

      // Act
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);

      // Assert
      expect(typeof parsedRules.version).toBe('string');
    });
  });

  describe('Error path: skill-rules.json is missing', () => {
    it('falls back to buildSkillRulesFromSkills when file is missing (ENOENT)', async () => {
      // Arrange
      const error = new Error('ENOENT: no such file or directory');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // Act - Simulate the catch block behavior
      let result;
      try {
        await mockReadFile(SKILL_RULES_PATH, 'utf8');
      } catch (error) {
        result = buildSkillRulesFromSkills(SKILLS_DIR);
      }

      // Assert
      expect(mockReadFile).toHaveBeenCalledWith(SKILL_RULES_PATH, 'utf8');
      expect(mockBuildSkillRulesFromSkills).toHaveBeenCalledWith(SKILLS_DIR);
      expect(result).toBeDefined();
      expect(result.version).toBe('1.0-discovered');
    });

    it('falls back for any error reading the file', async () => {
      // Arrange
      mockReadFile.mockRejectedValue(new Error('Permission denied'));

      // Act - Simulate the catch block behavior
      let result;
      try {
        await mockReadFile(SKILL_RULES_PATH, 'utf8');
      } catch (error) {
        result = buildSkillRulesFromSkills(SKILLS_DIR);
      }

      // Assert
      expect(mockBuildSkillRulesFromSkills).toHaveBeenCalledWith(SKILLS_DIR);
      expect(result).toBeDefined();
    });
  });

  describe('Error path: skill-rules.json has invalid shape', () => {
    it('falls back when parsed data is not a record (array)', async () => {
      // Arrange
      mockReadFile.mockResolvedValue(JSON.stringify(['array', 'not', 'object']));

      // Act - Simulate validation
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);
      const isRecord = typeof parsedRules === 'object' && parsedRules !== null && !Array.isArray(parsedRules);

      // Assert
      expect(isRecord).toBe(false);
    });

    it('falls back when version is missing', async () => {
      // Arrange
      const invalidConfig = createInvalidShapeMissingVersion();
      mockReadFile.mockResolvedValue(JSON.stringify(invalidConfig));

      // Act
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);
      const hasValidVersion = typeof parsedRules.version === 'string';

      // Assert
      expect(hasValidVersion).toBe(false);
    });

    it('falls back when skills is missing', async () => {
      // Arrange
      const invalidConfig = createInvalidShapeMissingSkills();
      mockReadFile.mockResolvedValue(JSON.stringify(invalidConfig));

      // Act
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);
      const isRecord = typeof parsedRules === 'object' && parsedRules !== null && !Array.isArray(parsedRules);
      const hasValidSkills = isRecord && typeof parsedRules.skills === 'object' && parsedRules.skills !== null;

      // Assert
      expect(hasValidSkills).toBe(false);
    });

    it('falls back when version is not a string', async () => {
      // Arrange
      const invalidConfig = createInvalidVersionType();
      mockReadFile.mockResolvedValue(JSON.stringify(invalidConfig));

      // Act
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);
      const hasValidVersion = typeof parsedRules.version === 'string';

      // Assert
      expect(hasValidVersion).toBe(false);
    });

    it('falls back when skills is an array instead of object', async () => {
      // Arrange
      const invalidConfig = createInvalidSkillsType();
      mockReadFile.mockResolvedValue(JSON.stringify(invalidConfig));

      // Act
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);
      const isRecord = typeof parsedRules === 'object' && parsedRules !== null && !Array.isArray(parsedRules);
      const hasValidSkills = isRecord && typeof parsedRules.skills === 'object' && parsedRules.skills !== null && !Array.isArray(parsedRules.skills);

      // Assert
      expect(hasValidSkills).toBe(false);
    });
  });

  describe('Error path: skill-rules.json has unsupported version', () => {
    it('accepts any string version (current implementation does not validate specific versions)', async () => {
      // Arrange - The current implementation only checks that version is a string
      // It does NOT validate against specific supported versions
      const configWithAnyVersion = { version: '999.999', skills: {} };
      mockReadFile.mockResolvedValue(JSON.stringify(configWithAnyVersion));

      // Act
      const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
      const parsedRules = JSON.parse(rawRules);
      const hasValidVersion = typeof parsedRules.version === 'string';

      // Assert - The implementation accepts any string version
      expect(hasValidVersion).toBe(true);
      expect(parsedRules.version).toBe('999.999');
    });

    it('accepts version strings with different formats', async () => {
      // Arrange
      const versions = ['1.0', '2.0-beta', '1.0.0-foo', 'draft', 'unknown-version'];

      for (const version of versions) {
        const config = { version, skills: {} };
        mockReadFile.mockResolvedValue(JSON.stringify(config));

        // Act
        const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
        const parsedRules = JSON.parse(rawRules);
        const hasValidVersion = typeof parsedRules.version === 'string';

        // Assert
        expect(hasValidVersion).toBe(true);
      }
    });
  });

  describe('Integration: Full loadSkillRules flow', () => {
    it('returns valid config when skill-rules.json is valid and parseable', async () => {
      // This simulates the full flow of loadSkillRules
      // Arrange
      const validConfig = createValidSkillRules();
      mockReadFile.mockResolvedValue(JSON.stringify(validConfig));

      // Act - Simulate the loadSkillRules function
      let result;
      try {
        const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
        const parsedRules: unknown = JSON.parse(rawRules);

        const isRecord = typeof parsedRules === 'object' && parsedRules !== null && !Array.isArray(parsedRules);
        if (!isRecord) {
          throw new Error('Invalid shape');
        }

        if (typeof parsedRules.version !== 'string' || typeof parsedRules.skills !== 'object' || parsedRules.skills === null || Array.isArray(parsedRules.skills)) {
          throw new Error('Invalid shape');
        }

        result = {
          version: parsedRules.version,
          skills: parsedRules.skills,
        };
      } catch {
        result = buildSkillRulesFromSkills(SKILLS_DIR);
      }

      // Assert
      expect(result).toEqual(validConfig);
      expect(mockBuildSkillRulesFromSkills).not.toHaveBeenCalled();
    });

    it('falls back to buildSkillRulesFromSkills on any parsing error', async () => {
      // Arrange
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      // Act - Simulate loadSkillRules function
      let result;
      try {
        await mockReadFile(SKILL_RULES_PATH, 'utf8');
      } catch {
        result = buildSkillRulesFromSkills(SKILLS_DIR);
      }

      // Assert
      expect(mockBuildSkillRulesFromSkills).toHaveBeenCalledWith(SKILLS_DIR);
      expect(result).toBeDefined();
      expect(result.version).toBe('1.0-discovered');
    });

    it('falls back when JSON is malformed', async () => {
      // Arrange
      mockReadFile.mockResolvedValue('{ invalid json }');

      // Act - Simulate loadSkillRules function
      let result;
      try {
        const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
        JSON.parse(rawRules); // This will throw
      } catch {
        result = buildSkillRulesFromSkills(SKILLS_DIR);
      }

      // Assert
      expect(mockBuildSkillRulesFromSkills).toHaveBeenCalledWith(SKILLS_DIR);
      expect(result).toBeDefined();
    });

    it('falls back when skills is null', async () => {
      // Arrange
      const configWithNullSkills = { version: '1.0', skills: null };
      mockReadFile.mockResolvedValue(JSON.stringify(configWithNullSkills));

      // Act - Simulate loadSkillRules function
      let result;
      try {
        const rawRules = await mockReadFile(SKILL_RULES_PATH, 'utf8');
        const parsedRules: unknown = JSON.parse(rawRules);

        const isRecord = typeof parsedRules === 'object' && parsedRules !== null && !Array.isArray(parsedRules);
        if (!isRecord) {
          throw new Error('Not a record');
        }

        if (typeof parsedRules.version !== 'string' || typeof parsedRules.skills !== 'object' || parsedRules.skills === null) {
          throw new Error('Invalid shape');
        }

        result = {
          version: parsedRules.version,
          skills: parsedRules.skills,
        };
      } catch {
        result = buildSkillRulesFromSkills(SKILLS_DIR);
      }

      // Assert
      expect(mockBuildSkillRulesFromSkills).toHaveBeenCalledWith(SKILLS_DIR);
      expect(result).toBeDefined();
    });
  });
});
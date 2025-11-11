import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { SkillRule } from '../types.js';

/**
 * Tests for Anthropic API client
 *
 * Validates API communication, response parsing, and error handling
 * for AI-powered skill intent analysis.
 */

// Mock the Anthropic SDK with a factory function
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn(),
  };
});

// Mock fs to prevent file system access during tests
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'Mock template: {{USER_PROMPT}} {{SKILL_DESCRIPTIONS}}'),
}));

describe('Anthropic API Client', () => {
  let mockAnthropicClient: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up API key for tests
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-12345';

    // Reset mock
    vi.clearAllMocks();

    // Create mock Anthropic client instance
    mockAnthropicClient = {
      messages: {
        create: vi.fn(),
      },
    };

    // Mock Anthropic constructor - default export should be a constructor function
    vi.mocked(Anthropic).mockImplementation(function (this: any) {
      return mockAnthropicClient;
    } as any);
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('should successfully call API and parse valid JSON response', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            primary_intent: 'Fix component bug',
            skills: [
              {
                name: 'frontend-framework',
                confidence: 0.9,
                reason: 'User wants to fix component code',
              },
            ],
          }),
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {
      'python-best-practices': {
        type: 'domain',
        description: 'Python development best practices',
      },
    };

    // Dynamically import to trigger module evaluation with mocks
    const { callAnthropicAPI } = await import('../anthropic-client.js');

    const result = await callAnthropicAPI('Fix the component bug', skills);

    expect(result.primary_intent).toBe('Fix component bug');
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('frontend-framework');
    expect(result.skills[0].confidence).toBe(0.9);
  });

  it('should throw descriptive error when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const skills: Record<string, SkillRule> = {
      'git-workflow': {
        type: 'domain',
      },
    };

    // Re-import to get fresh module with updated env
    vi.resetModules();
    const { callAnthropicAPI } = await import('../anthropic-client.js');

    await expect(callAnthropicAPI('Test prompt', skills)).rejects.toThrow(
      /ANTHROPIC_API_KEY not found/
    );

    await expect(callAnthropicAPI('Test prompt', skills)).rejects.toThrow(
      /https:\/\/console\.anthropic\.com/
    );

    await expect(callAnthropicAPI('Test prompt', skills)).rejects.toThrow(/\.env\.example/);
  });

  it('should handle JSON wrapped in markdown code fences', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text:
            '```json\n' +
            JSON.stringify({
              primary_intent: 'Test intent',
              skills: [{ name: 'test-skill', confidence: 0.8, reason: 'Testing' }],
            }) +
            '\n```',
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {
      'api-security': { type: 'guardrail' },
    };

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    const result = await callAnthropicAPI('Test', skills);

    expect(result.primary_intent).toBe('Test intent');
    expect(result.skills[0].name).toBe('test-skill');
  });

  it('should handle JSON wrapped in uppercase markdown fences', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text:
            '```JSON\n' +
            JSON.stringify({
              primary_intent: 'Uppercase fence test',
              skills: [],
            }) +
            '\n```',
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {};

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    const result = await callAnthropicAPI('Test', skills);

    expect(result.primary_intent).toBe('Uppercase fence test');
    expect(result.skills).toEqual([]);
  });

  it('should extract JSON when surrounded by extra text', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text:
            'Here is the analysis:\n' +
            JSON.stringify({
              primary_intent: 'Extra text test',
              skills: [{ name: 'skill-1', confidence: 0.7, reason: 'Test' }],
            }) +
            '\n\nHope this helps!',
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {
      'skill-developer': { type: 'domain' },
    };

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    const result = await callAnthropicAPI('Test', skills);

    expect(result.primary_intent).toBe('Extra text test');
    expect(result.skills[0].name).toBe('skill-1');
  });

  it('should throw error for non-text response content type', async () => {
    const mockResponse = {
      content: [
        {
          type: 'image',
          source: { type: 'base64', data: 'abc123' },
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {};

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    await expect(callAnthropicAPI('Test', skills)).rejects.toThrow(
      'Unexpected response type from Anthropic API'
    );
  });

  it('should propagate API errors (rate limit, network failures)', async () => {
    mockAnthropicClient.messages.create.mockRejectedValue(
      new Error('Rate limit exceeded: Please try again later')
    );

    const skills: Record<string, SkillRule> = {
      'python-best-practices': { type: 'domain' },
    };

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    await expect(callAnthropicAPI('Test', skills)).rejects.toThrow(/Rate limit exceeded/);
  });

  it('should extract JSON from response with code fences and no language tag', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text:
            '```\n' +
            JSON.stringify({
              primary_intent: 'No language tag',
              skills: [{ name: 'git-workflow', confidence: 0.75, reason: 'Testing' }],
            }) +
            '\n```',
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {
      'git-workflow': { type: 'domain' },
    };

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    const result = await callAnthropicAPI('Test', skills);

    expect(result.primary_intent).toBe('No language tag');
    expect(result.skills[0].name).toBe('git-workflow');
  });

  it('should throw error for malformed JSON response', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text: 'This is not valid JSON at all!',
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {};

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    await expect(callAnthropicAPI('Test', skills)).rejects.toThrow();
  });

  it('should use custom model when CLAUDE_SKILLS_MODEL env var is set', async () => {
    // Set custom model via environment variable
    process.env.CLAUDE_SKILLS_MODEL = 'claude-sonnet-4-5';

    const mockResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            primary_intent: 'Custom model test',
            skills: [{ name: 'test-skill', confidence: 0.85, reason: 'Testing custom model' }],
          }),
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {
      'test-skill': { type: 'domain' },
    };

    // Re-import to get fresh module with updated env
    vi.resetModules();
    const { callAnthropicAPI } = await import('../anthropic-client.js');

    const result = await callAnthropicAPI('Test custom model', skills);

    // Verify the API was called with the custom model
    expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-5',
      })
    );

    // Verify response was parsed correctly
    expect(result.primary_intent).toBe('Custom model test');
    expect(result.skills[0].name).toBe('test-skill');
  });

  it('should default to claude-haiku-4-5 when CLAUDE_SKILLS_MODEL is not set', async () => {
    // Ensure CLAUDE_SKILLS_MODEL is not set
    delete process.env.CLAUDE_SKILLS_MODEL;

    const mockResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            primary_intent: 'Default model test',
            skills: [],
          }),
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {};

    // Re-import to get fresh module with updated env
    vi.resetModules();
    const { callAnthropicAPI } = await import('../anthropic-client.js');

    await callAnthropicAPI('Test default model', skills);

    // Verify the API was called with the default model
    expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
      })
    );
  });

  it('should handle empty JSON response', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text: '{}',
        },
      ],
    };

    mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

    const skills: Record<string, SkillRule> = {};

    const { callAnthropicAPI } = await import('../anthropic-client.js');

    const result = await callAnthropicAPI('Test', skills);

    // Should parse but result will be missing expected fields
    expect(result).toEqual({});
  });
});

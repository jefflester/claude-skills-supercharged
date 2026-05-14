import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillRule, CommandRule } from '../types.js';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const VALID_INTENT_JSON = JSON.stringify({
  primary_intent: 'write tests',
  skills: [{ name: 'tdd-workflow', confidence: 0.85, reason: 'tests requested' }],
  commands: [{ name: 'quality-gate', confidence: 0.91, reason: 'quality check' }],
});

const skills: Record<string, SkillRule> = {
  'tdd-workflow': { type: 'domain', description: 'Use TDD.' },
};

const commands: Record<string, CommandRule> = {
  'quality-gate': {
    description: 'Run the quality gate.',
    source: 'markdown',
  },
};

// ── Mock helpers ─────────────────────────────────────────────────────────────

/** Build a mock Anthropic SDK module whose default export is a class */
function buildAnthropicMock(mockCreate: ReturnType<typeof vi.fn>) {
  return {
    default: function AnthropicClient() {
      // @ts-expect-error mock constructor
      this.messages = { create: mockCreate };
    },
  };
}

/** Build a mock OpenAI SDK module whose default export is a class */
function buildOpenAIMock(mockCreate: ReturnType<typeof vi.fn>) {
  return {
    default: function OpenAIClient() {
      // @ts-expect-error mock constructor
      this.chat = { completions: { create: mockCreate } };
    },
  };
}

// ── Module-level mocks ───────────────────────────────────────────────────────

// Mock debug-logger to silence output
vi.mock('../debug-logger.js', () => ({
  debugLog: vi.fn(),
}));

// Mock fs so getPromptTemplate / readOpenCodeApiKey don't hit disk
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync as (...args: unknown[]) => unknown),
    readFileSync: vi.fn(actual.readFileSync as (...args: unknown[]) => unknown),
  };
});

// Reset AI call rate limiter before every test to avoid cross-test interference
import { _resetRateLimiter } from '../ai-client.js';
beforeEach(() => {
  _resetRateLimiter();
});

// We need dynamic access to the mocked fs functions
import { existsSync, readFileSync } from 'fs';
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

// A minimal prompt template that satisfies buildPrompt
const MOCK_PROMPT_TEMPLATE = [
  'Analyze user intent. Skills: {{SKILL_DESCRIPTIONS}}',
  'Commands: {{COMMAND_DESCRIPTIONS}}',
  'Skill required >= {{SKILL_REQUIRED_THRESHOLD}}, suggested >= {{SKILL_SUGGESTED_THRESHOLD}}',
  'Command required >= {{COMMAND_REQUIRED_THRESHOLD}}, suggested >= {{COMMAND_SUGGESTED_THRESHOLD}}',
  'Max skills: {{MAX_REQUIRED_SKILLS}}, Max commands: {{MAX_REQUIRED_COMMANDS}}',
].join('\n');

/**
 * Set up the fs mocks so buildPrompt (via getPromptTemplate) finds a template.
 * Call this in beforeEach for tests that exercise callAIForIntentAnalysis.
 */
function stubPromptTemplate(): void {
  mockedExistsSync.mockImplementation((p: unknown) => {
    const s = String(p);
    return s.includes('intent-analysis-prompt.txt');
  });
  mockedReadFileSync.mockImplementation((p: unknown) => {
    const s = String(p);
    if (s.includes('intent-analysis-prompt.txt')) return MOCK_PROMPT_TEMPLATE;
    throw new Error(`ENOENT: no such file ${s}`);
  });
}

// ── validateOllamaUrl ────────────────────────────────────────────────────────

describe('validateOllamaUrl (via callOllamaIntentAnalysis)', () => {
  // validateOllamaUrl is not exported, so we test it indirectly through
  // callOllamaIntentAnalysis which calls it before fetch.

  beforeEach(() => {
    stubPromptTemplate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const privateAddresses = [
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    'localhost',
  ];

  for (const addr of privateAddresses) {
    it(`rejects explicitly-set OLLAMA_BASE_URL pointing to restricted address ${addr}`, async () => {
      vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
      vi.stubEnv('OLLAMA_BASE_URL', `http://${addr}:11434`);

      const { callAIForIntentAnalysis } = await import('../ai-client.js');

      await expect(
        callAIForIntentAnalysis('write tests', skills, commands)
      ).rejects.toThrow(/restricted address/i);
    });
  }

  it('rejects ::1 (IPv6 loopback) when explicitly set', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://[::1]:11434');

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/restricted address/i);
  });

  it('rejects 169.254.x.x link-local addresses when explicitly set', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://169.254.1.1:11434');

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/restricted address/i);
  });

  it('rejects malformed URLs', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_BASE_URL', 'not-a-url');

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/Invalid OLLAMA_BASE_URL|Ollama intent analysis failed/i);
  });

  it('rejects unsupported protocols (ftp)', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_BASE_URL', 'ftp://example.com');

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/Unsupported protocol|Ollama intent analysis failed/i);
  });

  it('allows default localhost URL when OLLAMA_BASE_URL is not set', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    delete process.env.OLLAMA_BASE_URL;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: VALID_INTENT_JSON }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    const result = await callAIForIntentAnalysis('write tests', skills, commands);

    expect(result.primary_intent).toBe('write tests');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('localhost:11434'),
      expect.any(Object)
    );
  });

  it('allows a public domain when explicitly set', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_BASE_URL', 'https://my-ollama.example.com');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: VALID_INTENT_JSON }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    const result = await callAIForIntentAnalysis('write tests', skills, commands);

    expect(result.primary_intent).toBe('write tests');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('my-ollama.example.com'),
      expect.any(Object)
    );
  });
});

// ── getUserPromptContent ─────────────────────────────────────────────────────

describe('getUserPromptContent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the prompt as-is when under the limit', async () => {
    const { getUserPromptContent } = await import('../ai-client.js');
    expect(getUserPromptContent('hello world')).toBe('hello world');
  });

  it('throws when prompt exceeds 50000 characters', async () => {
    const { getUserPromptContent } = await import('../ai-client.js');
    const longPrompt = 'x'.repeat(50001);

    expect(() => getUserPromptContent(longPrompt)).toThrow(/exceeds maximum length/i);
  });

  it('accepts prompt at exactly 50000 characters', async () => {
    const { getUserPromptContent } = await import('../ai-client.js');
    const exactPrompt = 'x'.repeat(50000);

    expect(getUserPromptContent(exactPrompt)).toBe(exactPrompt);
  });
});

// ── getProvider ──────────────────────────────────────────────────────────────

describe('getProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns anthropic by default', async () => {
    delete process.env.OPENCODE_SKILLS_PROVIDER;
    const { getProvider } = await import('../ai-client.js');
    expect(getProvider()).toBe('anthropic');
  });

  it('returns the provider from OPENCODE_SKILLS_PROVIDER env', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'openai');
    const { getProvider } = await import('../ai-client.js');
    expect(getProvider()).toBe('openai');
  });

  it('returns ollama when configured', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    const { getProvider } = await import('../ai-client.js');
    expect(getProvider()).toBe('ollama');
  });

  it('defaults to anthropic for unknown provider values', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'unknown-provider');
    const { getProvider } = await import('../ai-client.js');
    expect(getProvider()).toBe('anthropic');
  });

  it('is case-insensitive', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'OpenAI');
    const { getProvider } = await import('../ai-client.js');
    expect(getProvider()).toBe('openai');
  });
});

// ── getModel ─────────────────────────────────────────────────────────────────

describe('getModel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns default model for anthropic', async () => {
    delete process.env.OPENCODE_SKILLS_MODEL;
    const { getModel } = await import('../ai-client.js');
    expect(getModel('anthropic')).toBe('claude-haiku-4-5');
  });

  it('returns default model for openai', async () => {
    delete process.env.OPENCODE_SKILLS_MODEL;
    const { getModel } = await import('../ai-client.js');
    expect(getModel('openai')).toBe('gpt-4o-mini');
  });

  it('returns default model for ollama', async () => {
    delete process.env.OPENCODE_SKILLS_MODEL;
    const { getModel } = await import('../ai-client.js');
    expect(getModel('ollama')).toBe('llama3.1');
  });

  it('uses OPENCODE_SKILLS_MODEL when set', async () => {
    vi.stubEnv('OPENCODE_SKILLS_MODEL', 'custom-model');
    const { getModel } = await import('../ai-client.js');
    expect(getModel('anthropic')).toBe('custom-model');
  });

  it('strips provider prefix from configured model', async () => {
    vi.stubEnv('OPENCODE_SKILLS_MODEL', 'anthropic/my-model');
    const { getModel } = await import('../ai-client.js');
    expect(getModel('anthropic')).toBe('my-model');
  });

  it('does not strip a mismatched provider prefix', async () => {
    vi.stubEnv('OPENCODE_SKILLS_MODEL', 'openai/gpt-4');
    const { getModel } = await import('../ai-client.js');
    expect(getModel('anthropic')).toBe('openai/gpt-4');
  });
});

// ── getAnthropicApiKey (via callAnthropicIntentAnalysis) ─────────────────────

describe('Anthropic API key resolution', () => {
  beforeEach(() => {
    stubPromptTemplate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('throws when no API key is available', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENCODE_SKILLS_PROVIDER;

    // Ensure readOpenCodeApiKey returns nothing
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.includes('auth.json')) return false;
      return s.includes('intent-analysis-prompt.txt');
    });

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/Missing Anthropic API key/i);
  });

  it('uses ANTHROPIC_API_KEY from environment', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-key-env');
    delete process.env.OPENCODE_SKILLS_PROVIDER;

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: VALID_INTENT_JSON }],
    });

    vi.doMock('@anthropic-ai/sdk', () => buildAnthropicMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    const result = await callAIForIntentAnalysis('write tests', skills, commands);

    expect(result.primary_intent).toBe('write tests');
    expect(result.skills).toHaveLength(1);
    expect(result.commands).toHaveLength(1);
  });

  it('falls back to opencode auth.json when env key is absent', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENCODE_SKILLS_PROVIDER;

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.includes('auth.json')) return true;
      return s.includes('intent-analysis-prompt.txt');
    });
    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.includes('auth.json')) {
        return JSON.stringify({
          anthropic: { type: 'api', key: 'sk-from-auth-json' },
        });
      }
      if (s.includes('intent-analysis-prompt.txt')) return MOCK_PROMPT_TEMPLATE;
      throw new Error(`ENOENT: ${s}`);
    });

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: VALID_INTENT_JSON }],
    });

    vi.doMock('@anthropic-ai/sdk', () => buildAnthropicMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    const result = await callAIForIntentAnalysis('write tests', skills, commands);

    expect(result.primary_intent).toBe('write tests');
  });
});

// ── callAnthropicIntentAnalysis ──────────────────────────────────────────────

describe('callAnthropicIntentAnalysis', () => {
  beforeEach(() => {
    stubPromptTemplate();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-key');
    delete process.env.OPENCODE_SKILLS_PROVIDER;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends system prompt as the system field and user prompt in a user message', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: VALID_INTENT_JSON }],
    });

    vi.doMock('@anthropic-ai/sdk', () => buildAnthropicMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];

    // system is a top-level field, not embedded in messages
    expect(callArgs).toHaveProperty('system');
    expect(typeof callArgs.system).toBe('string');
    expect(callArgs.system.length).toBeGreaterThan(0);

    // user message is separate
    expect(callArgs.messages).toEqual([
      { role: 'user', content: 'write tests' },
    ]);
  });

  it('sets temperature and max_tokens on the Anthropic request', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: VALID_INTENT_JSON }],
    });

    vi.doMock('@anthropic-ai/sdk', () => buildAnthropicMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.1);
    expect(callArgs.max_tokens).toBe(10000);
  });

  it('wraps Anthropic SDK errors in a descriptive message', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('network timeout'));

    vi.doMock('@anthropic-ai/sdk', () => buildAnthropicMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/Anthropic intent analysis failed.*network timeout/i);
  });

  it('throws when Anthropic returns an empty response', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [],
    });

    vi.doMock('@anthropic-ai/sdk', () => buildAnthropicMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/empty response/i);
  });

  it('throws when @anthropic-ai/sdk is not installed', async () => {
    vi.doMock('@anthropic-ai/sdk', () => {
      throw new Error('Cannot find module');
    });

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/not installed/i);
  });
});

// ── callOpenAIIntentAnalysis ─────────────────────────────────────────────────

describe('callOpenAIIntentAnalysis', () => {
  beforeEach(() => {
    stubPromptTemplate();
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends system and user messages in the correct roles', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: VALID_INTENT_JSON } }],
    });

    vi.doMock('openai', () => buildOpenAIMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    expect(mockCreate).toHaveBeenCalledOnce();
    const [callArgs] = mockCreate.mock.calls[0];

    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[1].role).toBe('user');
    expect(callArgs.messages[1].content).toBe('write tests');
    expect(callArgs.temperature).toBe(0);
  });

  it('passes AbortSignal as second argument for timeout', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: VALID_INTENT_JSON } }],
    });

    vi.doMock('openai', () => buildOpenAIMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    // Second argument should contain signal
    const secondArg = mockCreate.mock.calls[0][1];
    expect(secondArg).toHaveProperty('signal');
    expect(secondArg.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/Missing OPENAI_API_KEY/i);
  });

  it('wraps OpenAI SDK errors', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('rate limit'));

    vi.doMock('openai', () => buildOpenAIMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/OpenAI intent analysis failed.*rate limit/i);
  });

  it('throws when OpenAI returns an empty response', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '' } }],
    });

    vi.doMock('openai', () => buildOpenAIMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/empty response/i);
  });

  it('throws when openai package is not installed', async () => {
    vi.doMock('openai', () => {
      throw new Error('Cannot find module');
    });

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/not installed/i);
  });
});

// ── callOllamaIntentAnalysis ─────────────────────────────────────────────────

describe('callOllamaIntentAnalysis', () => {
  beforeEach(() => {
    stubPromptTemplate();
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');
    delete process.env.OLLAMA_BASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends system prompt in the body system field and user prompt in prompt field', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: VALID_INTENT_JSON }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/generate');

    const body = JSON.parse(options.body as string);
    expect(body.system).toBeDefined();
    expect(typeof body.system).toBe('string');
    expect(body.system.length).toBeGreaterThan(0);
    expect(body.prompt).toBe('write tests');
    expect(body.stream).toBe(false);
  });

  it('applies AbortSignal timeout to the fetch call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: VALID_INTENT_JSON }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('handles HTTP error responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'model not loaded',
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/Ollama intent analysis failed.*500/i);
  });

  it('handles empty Ollama response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/empty response/i);
  });

  it('handles Ollama error field in response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'model "llama3.1" not found' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/model.*not found|empty response/i);
  });

  it('wraps fetch network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('write tests', skills, commands)
    ).rejects.toThrow(/Ollama intent analysis failed.*ECONNREFUSED/i);
  });

  it('strips trailing slashes from OLLAMA_BASE_URL', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', 'https://ollama.example.com///');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: VALID_INTENT_JSON }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://ollama.example.com/api/generate');
  });

  it('uses the correct model from getModel', async () => {
    vi.stubEnv('OPENCODE_SKILLS_MODEL', 'ollama/mistral');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: VALID_INTENT_JSON }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    await callAIForIntentAnalysis('write tests', skills, commands);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('mistral');
  });
});

// ── callAIForIntentAnalysis dispatch ─────────────────────────────────────────

describe('callAIForIntentAnalysis provider dispatch', () => {
  beforeEach(() => {
    stubPromptTemplate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('dispatches to Anthropic by default', async () => {
    delete process.env.OPENCODE_SKILLS_PROVIDER;
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: VALID_INTENT_JSON }],
    });

    vi.doMock('@anthropic-ai/sdk', () => buildAnthropicMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    const result = await callAIForIntentAnalysis('write tests', skills, commands);

    expect(result.primary_intent).toBe('write tests');
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('dispatches to OpenAI when provider is set', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai');

    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: VALID_INTENT_JSON } }],
    });

    vi.doMock('openai', () => buildOpenAIMock(mockCreate));

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    const result = await callAIForIntentAnalysis('write tests', skills, commands);

    expect(result.primary_intent).toBe('write tests');
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('dispatches to Ollama when provider is set', async () => {
    vi.stubEnv('OPENCODE_SKILLS_PROVIDER', 'ollama');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: VALID_INTENT_JSON }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callAIForIntentAnalysis } = await import('../ai-client.js');
    const result = await callAIForIntentAnalysis('write tests', skills, commands);

    expect(result.primary_intent).toBe('write tests');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('rejects oversized user prompts before dispatching', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');

    const { callAIForIntentAnalysis } = await import('../ai-client.js');

    await expect(
      callAIForIntentAnalysis('x'.repeat(50001), skills, commands)
    ).rejects.toThrow(/exceeds maximum length/i);
  });
});

// ── parseIntentAnalysis edge cases ───────────────────────────────────────────

describe('parseIntentAnalysis edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips markdown code fences from response', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    const wrapped = '```json\n' + VALID_INTENT_JSON + '\n```';
    const result = parseIntentAnalysis(wrapped);
    expect(result.primary_intent).toBe('write tests');
  });

  it('extracts JSON from text with preamble', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    const withPreamble = 'Here is the analysis:\n' + VALID_INTENT_JSON;
    const result = parseIntentAnalysis(withPreamble);
    expect(result.primary_intent).toBe('write tests');
  });

  it('clamps confidence values to [0, 1]', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    const result = parseIntentAnalysis(JSON.stringify({
      primary_intent: 'test',
      skills: [{ name: 'skill-a', confidence: 1.5, reason: 'high' }],
      commands: [{ name: 'cmd-a', confidence: -0.3, reason: 'low' }],
    }));

    expect(result.skills[0].confidence).toBe(1);
    expect(result.commands![0].confidence).toBe(0);
  });

  it('strips domain/guardrail suffixes from skill names', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    const result = parseIntentAnalysis(JSON.stringify({
      primary_intent: 'test',
      skills: [
        { name: 'my-skill (domain)', confidence: 0.8, reason: 'r' },
        { name: 'another-skill (guardrail)', confidence: 0.7, reason: 'r' },
      ],
    }));

    expect(result.skills[0].name).toBe('my-skill');
    expect(result.skills[1].name).toBe('another-skill');
  });

  it('throws for invalid JSON', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    expect(() => parseIntentAnalysis('not json')).toThrow(/Failed to parse/i);
  });

  it('throws when primary_intent is missing', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    expect(() => parseIntentAnalysis(JSON.stringify({
      skills: [],
    }))).toThrow(/Missing primary_intent/i);
  });

  it('throws when skills is not an array', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    expect(() => parseIntentAnalysis(JSON.stringify({
      primary_intent: 'test',
      skills: 'not-array',
    }))).toThrow(/skills must be an array/i);
  });

  it('throws when skill_rankings is not an array', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    expect(() => parseIntentAnalysis(JSON.stringify({
      primary_intent: 'test',
      skills: [],
      skill_rankings: 'bad',
    }))).toThrow(/skill_rankings must be an array/i);
  });

  it('throws when command entry is missing fields', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    expect(() => parseIntentAnalysis(JSON.stringify({
      primary_intent: 'test',
      skills: [],
      commands: [{ name: 'cmd' }],
    }))).toThrow(/must include name, confidence, and reason/i);
  });

  it('parses skill_rankings with optional reason', async () => {
    const { parseIntentAnalysis } = await import('../ai-client.js');
    const result = parseIntentAnalysis(JSON.stringify({
      primary_intent: 'test',
      skills: [],
      skill_rankings: [
        { name: 'skill-a', confidence: 0.9, reason: 'top pick' },
        { name: 'skill-b', confidence: 0.3 },
      ],
    }));

    expect(result.skill_rankings).toHaveLength(2);
    expect(result.skill_rankings![0].reason).toBe('top pick');
    expect(result.skill_rankings![1].reason).toBeUndefined();
  });
});

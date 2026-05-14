import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the JSON-RPC layer and helpers in mcp-server.ts.
 *
 * Strategy: The JSON-RPC helpers (createResponse, createErrorResponse,
 * normalizeToolResult, handleRequest, handleToolsCall) are NOT exported.
 * We test them indirectly through the exported `main()` which starts the
 * message loop on stdin/stdout, and through `selectSkillsTool` for the
 * tool-call path.
 *
 * We mock process.stdin as a readable stream and capture process.stdout.write
 * to inspect JSON-RPC responses.
 */

const mocks = vi.hoisted(() => ({
  callAIForIntentAnalysis: vi.fn(),
  getProvider: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock('../../hooks/lib/ai-client.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../hooks/lib/ai-client.js');
  return {
    ...actual,
    callAIForIntentAnalysis: mocks.callAIForIntentAnalysis,
    getProvider: mocks.getProvider,
    getModel: mocks.getModel,
  };
});

import { selectSkillsTool } from '../mcp-server.js';

// ---------------------------------------------------------------------------
// Helper: Encode a JSON-RPC message in Content-Length framing
// ---------------------------------------------------------------------------
function encodeJsonRpc(obj: unknown): string {
  const body = JSON.stringify(obj);
  const byteLength = Buffer.byteLength(body, 'utf8');
  return `Content-Length: ${byteLength}\r\n\r\n${body}`;
}

// ---------------------------------------------------------------------------
// Helper: Parse all JSON-RPC responses from a captured stdout buffer
// ---------------------------------------------------------------------------
function parseResponses(raw: string): unknown[] {
  const results: unknown[] = [];
  let remaining = raw;
  while (remaining.length > 0) {
    const match = remaining.match(/Content-Length:\s*(\d+)\r\n\r\n/);
    if (!match) break;
    const contentLength = Number(match[1]);
    const bodyStart = match.index! + match[0].length;
    const bodyText = remaining.slice(bodyStart, bodyStart + contentLength);
    results.push(JSON.parse(bodyText));
    remaining = remaining.slice(bodyStart + contentLength);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helper: Send messages through main() and collect responses
// ---------------------------------------------------------------------------
async function sendMessages(messages: unknown[]): Promise<unknown[]> {
  const { Readable } = await import('stream');

  const payload = messages.map((m) => encodeJsonRpc(m)).join('');
  const readable = new Readable({
    read() {
      this.push(Buffer.from(payload, 'utf8'));
      this.push(null);
    },
  });

  const originalStdin = process.stdin;
  const originalStdoutWrite = process.stdout.write;

  let captured = '';
  const writeSpy = vi.fn((...args: unknown[]) => {
    const chunk = args[0];
    if (typeof chunk === 'string') {
      captured += chunk;
    } else if (Buffer.isBuffer(chunk)) {
      captured += chunk.toString('utf8');
    }
    return true;
  });

  try {
    Object.defineProperty(process, 'stdin', { value: readable, writable: true, configurable: true });
    process.stdout.write = writeSpy as unknown as typeof process.stdout.write;

    const { main } = await import('../mcp-server.js');
    await main();

    return parseResponses(captured);
  } finally {
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
    process.stdout.write = originalStdoutWrite;
  }
}

describe('mcp-server JSON-RPC layer', () => {
  beforeEach(() => {
    mocks.callAIForIntentAnalysis.mockReset();
    mocks.getProvider.mockReturnValue('anthropic');
    mocks.getModel.mockReturnValue('claude-haiku-4-5');
    mocks.callAIForIntentAnalysis.mockResolvedValue({
      primary_intent: 'test',
      skills: [{ name: 'tdd-workflow', confidence: 0.9, reason: 'testing' }],
      commands: [],
    });
  });

  // =========================================================================
  // selectSkillsTool direct tests (exercises handleToolsCall indirectly)
  // =========================================================================

  describe('selectSkillsTool validation', () => {
    it('rejects empty prompt string', async () => {
      await expect(selectSkillsTool({ prompt: '' })).rejects.toThrow('Invalid prompt');
    });

    it('rejects whitespace-only prompt', async () => {
      await expect(selectSkillsTool({ prompt: '   ' })).rejects.toThrow('Invalid prompt');
    });

    it('returns valid structure for a good prompt', async () => {
      const result = await selectSkillsTool({ prompt: 'Write unit tests' });
      expect(result).toHaveProperty('skills');
      expect(result).toHaveProperty('suggested');
      expect(result).toHaveProperty('affinity');
      expect(result).toHaveProperty('scores');
      expect(result).toHaveProperty('labels');
      expect(result).toHaveProperty('commands');
      expect(result).toHaveProperty('suggestedCommands');
      expect(result).toHaveProperty('alreadyLoadedCommands');
      expect(result).toHaveProperty('commandScores');
      expect(Array.isArray(result.skills)).toBe(true);
      expect(Array.isArray(result.suggested)).toBe(true);
      expect(Array.isArray(result.affinity)).toBe(true);
      expect(Array.isArray(result.commands)).toBe(true);
    });

    it('returns scores as a record of numbers', async () => {
      mocks.callAIForIntentAnalysis.mockResolvedValue({
        primary_intent: 'test',
        skills: [
          { name: 'tdd-workflow', confidence: 0.85, reason: 'r1' },
          { name: 'verification-loop', confidence: 0.7, reason: 'r2' },
        ],
        commands: [],
      });

      const result = await selectSkillsTool({ prompt: 'Test this module' });
      for (const [key, value] of Object.entries(result.scores)) {
        expect(typeof key).toBe('string');
        expect(typeof value).toBe('number');
      }
    });

    it('handles threshold parameter', async () => {
      const result = await selectSkillsTool({
        prompt: 'Build a feature',
        threshold: 0.95,
      });
      expect(result).toHaveProperty('skills');
    });

    it('handles sessionId parameter for state persistence', async () => {
      const sessionId = `jsonrpc-test-${Date.now()}`;
      const first = await selectSkillsTool({
        prompt: 'Write tests',
        sessionId,
      });
      expect(first).toHaveProperty('skills');

      const second = await selectSkillsTool({
        prompt: 'Write tests',
        sessionId,
      });
      // Second call should filter out already-acknowledged skills
      expect(second).toHaveProperty('skills');
    });
  });

  // =========================================================================
  // JSON-RPC message loop tests (exercises handleRequest and helpers)
  // =========================================================================

  describe('handleRequest via message loop', () => {
    it('responds to initialize with protocol version and capabilities', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { jsonrpc: string; id: number; result: unknown };
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(1);
      const result = resp.result as {
        protocolVersion: string;
        capabilities: { tools: object };
        serverInfo: { name: string; version: string };
      };
      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.capabilities).toHaveProperty('tools');
      expect(result.serverInfo.name).toBe('opencode-dynamic-skills');
    });

    it('responds to tools/list with tool schema', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { result: { tools: Array<{ name: string; inputSchema: object }> } };
      expect(resp.result.tools).toHaveLength(1);
      expect(resp.result.tools[0].name).toBe('select_skills');
      expect(resp.result.tools[0].inputSchema).toHaveProperty('properties');
    });

    it('responds to shutdown with null result', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 3, method: 'shutdown', params: {} },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { jsonrpc: string; id: number; result: unknown };
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(3);
      expect(resp.result).toBeNull();
    });

    it('returns -32601 for unknown method', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 4, method: 'nonexistent/method', params: {} },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32601);
      expect(resp.error.message).toContain('Method not found');
    });

    it('returns -32600 for missing jsonrpc version', async () => {
      const responses = await sendMessages([
        { id: 5, method: 'initialize', params: {} },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32600);
      expect(resp.error.message).toContain('jsonrpc must be "2.0"');
    });

    it('returns -32600 for wrong jsonrpc version', async () => {
      const responses = await sendMessages([
        { jsonrpc: '1.0', id: 6, method: 'initialize', params: {} },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32600);
    });

    it('returns -32600 for missing method', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 7 },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32600);
      expect(resp.error.message).toContain('method is required');
    });

    it('returns nothing for notifications (no id)', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]);

      expect(responses).toHaveLength(0);
    });

    it('handles tools/call with valid prompt', async () => {
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: { prompt: 'Write unit tests for the auth module' },
        },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { jsonrpc: string; id: number; result: unknown };
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(10);
      const result = resp.result as { content: Array<{ type: string; text: string }>; structuredContent: unknown };
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.structuredContent).toBeDefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('skills');
      expect(parsed).toHaveProperty('commands');
    });

    it('returns -32602 for tools/call with missing params', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 11, method: 'tools/call' },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toContain('Invalid params');
    });

    it('returns -32602 for tools/call with non-object params', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 12, method: 'tools/call', params: 'not-an-object' },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32602);
    });

    it('returns -32602 for tools/call with empty prompt', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { prompt: '' } },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toContain('prompt must be a non-empty string');
    });

    it('returns -32602 for tools/call with missing prompt', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { threshold: 0.5 } },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32602);
    });

    it('returns -32602 for tools/call with invalid session_id type', async () => {
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 15,
          method: 'tools/call',
          params: { prompt: 'test', session_id: 123 },
        },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toContain('session_id must be a string');
    });

    it('returns -32602 for tools/call with invalid threshold type', async () => {
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 16,
          method: 'tools/call',
          params: { prompt: 'test', threshold: 'high' },
        },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toContain('threshold must be a number');
    });

    it('handles multiple messages in sequence', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 20, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 22, method: 'shutdown', params: {} },
      ]);

      expect(responses).toHaveLength(3);
      expect((responses[0] as { id: number }).id).toBe(20);
      expect((responses[1] as { id: number }).id).toBe(21);
      expect((responses[2] as { id: number }).id).toBe(22);
    });

    it('handles tools/call with valid session_id and threshold', async () => {
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 30,
          method: 'tools/call',
          params: {
            prompt: 'Implement authentication',
            session_id: `test-session-${Date.now()}`,
            threshold: 0.6,
          },
        },
      ]);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as { result: unknown; error?: unknown };
      expect(resp.error).toBeUndefined();
      expect(resp.result).toBeDefined();
    });
  });

  // =========================================================================
  // normalizeToolResult tested indirectly via tools/call response shape
  // =========================================================================

  describe('normalizeToolResult (indirect via tools/call)', () => {
    it('produces content array with a single text entry', async () => {
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 40,
          method: 'tools/call',
          params: { prompt: 'Help me debug this' },
        },
      ]);

      const resp = responses[0] as { result: { content: Array<{ type: string; text: string }>; structuredContent: unknown } };
      expect(resp.result.content).toHaveLength(1);
      expect(resp.result.content[0].type).toBe('text');
      expect(typeof resp.result.content[0].text).toBe('string');
    });

    it('produces structuredContent matching the text content', async () => {
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 41,
          method: 'tools/call',
          params: { prompt: 'Refactor this component' },
        },
      ]);

      const resp = responses[0] as { result: { content: Array<{ type: string; text: string }>; structuredContent: Record<string, unknown> } };
      const textPayload = JSON.parse(resp.result.content[0].text);
      expect(textPayload).toEqual(resp.result.structuredContent);
    });

    it('structuredContent has expected fields', async () => {
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/call',
          params: { prompt: 'Add error handling' },
        },
      ]);

      const resp = responses[0] as { result: { structuredContent: Record<string, unknown> } };
      const sc = resp.result.structuredContent;
      expect(sc).toHaveProperty('skills');
      expect(sc).toHaveProperty('suggested');
      expect(sc).toHaveProperty('affinity');
      expect(sc).toHaveProperty('scores');
      expect(sc).toHaveProperty('commands');
      expect(sc).toHaveProperty('suggestedCommands');
      expect(sc).toHaveProperty('alreadyLoadedCommands');
      expect(sc).toHaveProperty('commandScores');
    });
  });

  // =========================================================================
  // createResponse / createErrorResponse tested via response shape
  // =========================================================================

  describe('JSON-RPC response format', () => {
    it('successful responses have jsonrpc 2.0 and matching id', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 50, method: 'initialize', params: {} },
      ]);
      const resp = responses[0] as { jsonrpc: string; id: number; result: unknown; error?: unknown };
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(50);
      expect(resp.result).toBeDefined();
      expect(resp.error).toBeUndefined();
    });

    it('error responses have jsonrpc 2.0, matching id, and error object', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 51, method: 'tools/call', params: { prompt: '' } },
      ]);
      const resp = responses[0] as { jsonrpc: string; id: number; result?: unknown; error: { code: number; message: string } };
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(51);
      expect(resp.error).toBeDefined();
      expect(typeof resp.error.code).toBe('number');
      expect(typeof resp.error.message).toBe('string');
    });

    it('error responses from tools/call include error object with code and message', async () => {
      // Validation errors (-32602) are the most reliable way to test error response shape
      const responses = await sendMessages([
        {
          jsonrpc: '2.0',
          id: 52,
          method: 'tools/call',
          params: { prompt: 'valid', session_id: 999 },
        },
      ]);

      const resp = responses[0] as { jsonrpc: string; id: number; error: { code: number; message: string } };
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(52);
      expect(resp.error.code).toBe(-32602);
      expect(typeof resp.error.message).toBe('string');
    });

    it('error response for unknown method includes the method name', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 53, method: 'resources/list', params: {} },
      ]);

      const resp = responses[0] as { error: { code: number; message: string } };
      expect(resp.error.code).toBe(-32601);
      expect(resp.error.message).toContain('resources/list');
    });

    it('handles string id values', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: 'abc-123', method: 'initialize', params: {} },
      ]);
      const resp = responses[0] as { id: string };
      expect(resp.id).toBe('abc-123');
    });

    it('handles null id values', async () => {
      const responses = await sendMessages([
        { jsonrpc: '2.0', id: null, method: 'initialize', params: {} },
      ]);
      const resp = responses[0] as { id: null };
      expect(resp.id).toBeNull();
    });
  });

  // =========================================================================
  // Parse error handling
  // =========================================================================

  describe('parse error handling', () => {
    it('returns -32700 for malformed JSON', async () => {
      const { Readable } = await import('stream');

      const invalidBody = 'this is not json{{{';
      const payload = `Content-Length: ${Buffer.byteLength(invalidBody)}\r\n\r\n${invalidBody}`;
      const readable = new Readable({
        read() {
          this.push(Buffer.from(payload, 'utf8'));
          this.push(null);
        },
      });

      const originalStdin = process.stdin;
      const originalStdoutWrite = process.stdout.write;

      let captured = '';
      const writeSpy = vi.fn((...args: unknown[]) => {
        const chunk = args[0];
        if (typeof chunk === 'string') captured += chunk;
        else if (Buffer.isBuffer(chunk)) captured += chunk.toString('utf8');
        return true;
      });

      try {
        Object.defineProperty(process, 'stdin', { value: readable, writable: true, configurable: true });
        process.stdout.write = writeSpy as unknown as typeof process.stdout.write;

        const { main } = await import('../mcp-server.js');
        await main();

        const responses = parseResponses(captured);
        expect(responses).toHaveLength(1);
        const resp = responses[0] as { error: { code: number; message: string } };
        expect(resp.error.code).toBe(-32700);
        expect(resp.error.message).toContain('Parse error');
      } finally {
        Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
        process.stdout.write = originalStdoutWrite;
      }
    });
  });
});

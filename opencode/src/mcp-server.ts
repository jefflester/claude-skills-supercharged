import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { discoverCommands, resolveCommandDiscoveryOptions } from '../hooks/lib/command-discovery.js';
import { filterCommandReferences } from '../hooks/lib/command-filtration.js';
import type {
  CommandRule,
} from '../hooks/lib/types.js';
import type {
  SelectionLabel,
} from './selection-core.js';
import {
  buildCommandConfidenceBuckets,
  buildConfidenceBuckets,
  getPluginDirectory,
  getProjectDirectory,
  getSelectionLabel,
  isRecord,
  loadRuntimeModules,
  loadSkillRules,
  parseCommandThreshold,
  parseNumberOption,
  parseSelectionThreshold,
  resolveStateDirectory,
  withConsoleSuppressed,
} from './selection-core.js';

export { buildCommandConfidenceBuckets, parseNumberOption, parseSelectionThreshold } from './selection-core.js';

const MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10 MB

interface SelectSkillsInput {
  prompt: string;
  sessionId?: string;
  threshold?: number;
}

interface SelectSkillsResult {
  skills: string[];
  suggested: string[];
  affinity: string[];
  scores: Record<string, number>;
  labels: Record<string, SelectionLabel>;
  commands: string[];
  suggestedCommands: string[];
  alreadyLoadedCommands: string[];
  commandScores: Record<string, number>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcErrorPayload;
}

interface JsonRpcMessage {
  content?: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

let cachedCommandRules:
  | {
      projectDirectory: string;
      signature: string;
      rules: Record<string, CommandRule>;
      validatedAtMs: number;
    }
  | null = null;

function getCommandCacheTtlMs(): number {
  const raw = process.env.OPENCODE_COMMAND_CACHE_TTL_MS;
  const parsed = raw ? Number(raw) : 5000;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5000;
}

async function computePathStatSignature(path: string): Promise<string> {
  try {
    const stats = await stat(path);
    return `${stats.mtimeMs}:${stats.size}:${stats.isDirectory() ? 'd' : 'f'}`;
  } catch {
    return 'missing';
  }
}

async function computeCommandsDirSignature(dirPath: string): Promise<string> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const mdEntries = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name)
      .sort();

    const parts: string[] = [];
    for (const name of mdEntries) {
      const fullPath = join(dirPath, name);
      parts.push(`${name}:${await computePathStatSignature(fullPath)}`);
    }

    return `${await computePathStatSignature(dirPath)}|${parts.join('|')}`;
  } catch {
    return 'missing';
  }
}

async function computeCommandDiscoverySignature(projectDirectory: string): Promise<{
  options: ReturnType<typeof resolveCommandDiscoveryOptions>;
  signature: string;
}> {
  const options = resolveCommandDiscoveryOptions(projectDirectory);
  const configPath = options.configPath || '';
  const commandsDirs = (options.commandsDirs || []).slice().sort();

  const configSignature = configPath
    ? await computePathStatSignature(configPath)
    : 'no-config';

  const dirSignatures: string[] = [];
  for (const dir of commandsDirs) {
    dirSignatures.push(`${dir}:${await computeCommandsDirSignature(dir)}`);
  }

  return {
    options,
    signature: `${projectDirectory}|${configPath}|${configSignature}|${dirSignatures.join(';')}`,
  };
}

async function getCachedCommandRules(projectDirectory: string): Promise<Record<string, CommandRule>> {
  const now = Date.now();
  const ttlMs = getCommandCacheTtlMs();

  const { options, signature } = await computeCommandDiscoverySignature(projectDirectory);
  if (cachedCommandRules && cachedCommandRules.projectDirectory === projectDirectory) {
    if (cachedCommandRules.signature === signature) {
      // Keep cache fresh when signature is unchanged.
      if (now - cachedCommandRules.validatedAtMs >= ttlMs) {
        cachedCommandRules.validatedAtMs = now;
      }
      return cachedCommandRules.rules;
    }
  }

  const rules = discoverCommands(options);
  cachedCommandRules = { projectDirectory, signature, rules, validatedAtMs: now };
  return rules;
}

export async function selectSkillsTool(input: SelectSkillsInput): Promise<SelectSkillsResult> {
  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    throw new Error('Invalid prompt: prompt must be a non-empty string.');
  }

  const projectDirectory = getProjectDirectory();
  const pluginDirectory = getPluginDirectory();
  const rules = await loadSkillRules();
  const commandRules = await getCachedCommandRules(projectDirectory);
  const modules = await loadRuntimeModules();
  const quietMode = true;
  const promptText = input.prompt.trim();

  const analysis = await withConsoleSuppressed(quietMode, () =>
    modules.analyzeIntent(promptText, rules.skills, commandRules)
  );

  const threshold = parseSelectionThreshold(input.threshold);
  const confidenceBuckets = buildConfidenceBuckets(analysis, threshold);
  const commandConfidenceBuckets = buildCommandConfidenceBuckets(
    analysis,
    parseCommandThreshold()
  );
  const stateDirectory = await resolveStateDirectory(pluginDirectory, projectDirectory);
  const acknowledgedState = input.sessionId
    ? await withConsoleSuppressed(quietMode, () =>
        Promise.resolve(modules.readAcknowledgedState(stateDirectory, input.sessionId!))
      )
    : { acknowledgedSkills: [], acknowledgedCommands: [] };
  const acknowledgedSkills = acknowledgedState.acknowledgedSkills;
  const acknowledgedCommands = acknowledgedState.acknowledgedCommands;
  const commandFiltration = filterCommandReferences(
    commandConfidenceBuckets.required,
    commandConfidenceBuckets.suggested,
    acknowledgedCommands,
    commandRules
  );
  const alreadyLoadedCommands = Array.from(
    new Set(
      [...commandConfidenceBuckets.required, ...commandConfidenceBuckets.suggested].filter((name) =>
        acknowledgedCommands.includes(name)
      )
    )
  );

  const filtration = await withConsoleSuppressed(quietMode, () =>
    Promise.resolve(
      modules.filterAndPromoteSkills(
        confidenceBuckets.required,
        confidenceBuckets.suggested,
        acknowledgedSkills,
        rules.skills
      )
    )
  );

  const affinitySkills = await withConsoleSuppressed(quietMode, () =>
    Promise.resolve(modules.findAffinityInjections(filtration.toInject, acknowledgedSkills, rules.skills))
  );

  const resolvedSkills = await withConsoleSuppressed(quietMode, () =>
    Promise.resolve(modules.resolveSkillDependencies([...filtration.toInject, ...affinitySkills], rules.skills))
  );

  const affinitySkillSet = new Set(affinitySkills);
  const baseSkills = resolvedSkills.filter((skillName) => !affinitySkillSet.has(skillName));
  const requiredSkillSet = new Set(confidenceBuckets.required);
  const promotedSkillSet = new Set(filtration.promoted);
  const labels: Record<string, SelectionLabel> = {};
  const scores: Record<string, number> = {};

  for (const skillName of baseSkills) {
    labels[skillName] = getSelectionLabel(skillName, requiredSkillSet, promotedSkillSet, affinitySkillSet);

    const confidence = confidenceBuckets.scores[skillName];
    if (typeof confidence === 'number') {
      scores[skillName] = confidence;
    }
  }

  for (const skillName of affinitySkills) {
    labels[skillName] = 'affinity';

    const confidence = confidenceBuckets.scores[skillName];
    if (typeof confidence === 'number') {
      scores[skillName] = confidence;
    }
  }

  for (const skillName of filtration.remainingSuggested) {
    labels[skillName] = 'suggested';

    const confidence = confidenceBuckets.scores[skillName];
    if (typeof confidence === 'number') {
      scores[skillName] = confidence;
    }
  }

  const injectedSkills = Array.from(new Set([...baseSkills, ...affinitySkills]));

  if (input.sessionId) {
    const updatedAcknowledgedSkills = Array.from(new Set([...acknowledgedSkills, ...injectedSkills]));
    const injectedCommands = commandFiltration.toInject;
    const updatedAcknowledgedCommands = Array.from(
      new Set([...acknowledgedCommands, ...injectedCommands])
    );
    await withConsoleSuppressed(quietMode, () =>
      Promise.resolve(
        modules.writeSessionState(
          stateDirectory,
          input.sessionId!,
          updatedAcknowledgedSkills,
          injectedSkills,
          updatedAcknowledgedCommands,
          injectedCommands
        )
      )
    );
  }

  return {
    skills: baseSkills,
    suggested: filtration.remainingSuggested,
    affinity: affinitySkills,
    scores,
    labels,
    commands: commandFiltration.toInject,
    suggestedCommands: commandFiltration.remainingSuggested,
    alreadyLoadedCommands,
    commandScores: commandConfidenceBuckets.scores,
  };
}

function createResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function createErrorResponse(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function writeMessage(message: JsonRpcResponse): void {
  const bodyText = JSON.stringify(message);
  const bodyLength = Buffer.byteLength(bodyText, 'utf8');
  process.stdout.write(`Content-Length: ${bodyLength}\r\n\r\n${bodyText}`);
}

function normalizeToolResult(selection: SelectSkillsResult): JsonRpcMessage {
  const payload = {
    skills: selection.skills,
    suggested: selection.suggested,
    affinity: selection.affinity,
    scores: selection.scores,
    commands: selection.commands,
    suggestedCommands: selection.suggestedCommands,
    alreadyLoadedCommands: selection.alreadyLoadedCommands,
    commandScores: selection.commandScores,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

async function handleToolsCall(requestId: number | string | null, params: unknown): Promise<JsonRpcResponse> {
  if (!isRecord(params)) {
    return createErrorResponse(requestId, -32602, 'Invalid params: expected an object.');
  }

  const promptValue = params.prompt;
  const sessionIdValue = params.session_id;
  const thresholdValue = params.threshold;

  if (typeof promptValue !== 'string' || promptValue.trim().length === 0) {
    return createErrorResponse(requestId, -32602, 'Invalid params: prompt must be a non-empty string.');
  }

  if (sessionIdValue !== undefined && typeof sessionIdValue !== 'string') {
    return createErrorResponse(requestId, -32602, 'Invalid params: session_id must be a string when provided.');
  }

  if (thresholdValue !== undefined && typeof thresholdValue !== 'number') {
    return createErrorResponse(requestId, -32602, 'Invalid params: threshold must be a number when provided.');
  }

  try {
    const selection = await selectSkillsTool({
      prompt: promptValue,
      sessionId: sessionIdValue,
      threshold: thresholdValue,
    });

    return createResponse(requestId, normalizeToolResult(selection));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResponse(requestId, -32603, message, { prompt: promptValue });
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (request.jsonrpc !== '2.0') {
    return createErrorResponse(request.id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0".');
  }

  if (typeof request.method !== 'string' || request.method.length === 0) {
    return createErrorResponse(request.id ?? null, -32600, 'Invalid Request: method is required.');
  }

  if (request.id === undefined) {
    return null;
  }

  if (request.method === 'initialize') {
    return createResponse(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'opencode-dynamic-skills',
        version: '1.0.0',
      },
    });
  }

  if (request.method === 'tools/list') {
    return createResponse(request.id, {
      tools: [
        {
          name: 'select_skills',
          description: 'Analyze a user prompt and select matching OpenCode skills.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              prompt: { type: 'string', description: 'User prompt to analyze' },
              session_id: { type: 'string', description: 'Session ID for duplicate prevention' },
              threshold: { type: 'number', description: 'Confidence threshold override' },
            },
            required: ['prompt'],
          },
        },
      ],
    });
  }

  if (request.method === 'tools/call') {
    return handleToolsCall(request.id, request.params);
  }

  if (request.method === 'shutdown') {
    return createResponse(request.id, null);
  }

  if (request.method === 'exit') {
    process.exitCode = 0;
    return null;
  }

  return createErrorResponse(request.id ?? null, -32601, `Method not found: ${request.method}`);
}

async function startMessageLoop(): Promise<void> {
  let buffer = Buffer.alloc(0);
  let processingPromise: Promise<void> = Promise.resolve();
  const headerSeparator = Buffer.from('\r\n\r\n');

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    processingPromise = processingPromise.then(async () => {
      while (true) {
        const headerEnd = buffer.indexOf(headerSeparator);
        if (headerEnd < 0) {
          return;
        }

        const headerText = buffer.slice(0, headerEnd).toString('utf8');
        const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!contentLengthMatch) {
          buffer = buffer.slice(headerEnd + headerSeparator.length);
          continue;
        }

        const contentLength = Number(contentLengthMatch[1]);
        if (contentLength > MAX_CONTENT_LENGTH) {
          writeMessage(createErrorResponse(null, -32600, `Content-Length ${contentLength} exceeds maximum ${MAX_CONTENT_LENGTH}`));
          buffer = buffer.slice(headerEnd + headerSeparator.length);
          continue;
        }
        const bodyStart = headerEnd + headerSeparator.length;
        const bodyEnd = bodyStart + contentLength;

        if (buffer.length < bodyEnd) {
          return;
        }

        const messageBody = buffer.slice(bodyStart, bodyEnd).toString('utf8');
        buffer = buffer.slice(bodyEnd);

        let parsedMessage: JsonRpcRequest;
        try {
          parsedMessage = JSON.parse(messageBody) as JsonRpcRequest;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          writeMessage(createErrorResponse(null, -32700, `Parse error: ${message}`));
          continue;
        }

        try {
          const response = await handleRequest(parsedMessage);
          if (response) {
            writeMessage(response);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          writeMessage(createErrorResponse(parsedMessage.id ?? null, -32603, message));
        }
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      try {
        writeMessage(createErrorResponse(null, -32603, message));
      } catch (writeErr) {
        process.stderr.write(`MCP: failed to write error response: ${String(writeErr)}\n`);
      }
    });
  });

  await new Promise<void>((resolve) => {
    process.stdin.on('close', resolve);
    process.stdin.on('end', resolve);
  });

  await processingPromise.catch(() => {});
}

export async function main(): Promise<void> {
  await loadRuntimeModules();
  await startMessageLoop();
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

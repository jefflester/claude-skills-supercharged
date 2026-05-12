import { readFile, access, readdir, stat } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { debugLog } from '../hooks/lib/debug-logger.js';
import { buildSkillRulesFromSkills, SKILL_RULES_PATH, SKILLS_DIR } from '../hooks/lib/skill-discovery.js';
import { discoverCommands, resolveCommandDiscoveryOptions } from '../hooks/lib/command-discovery.js';
import { filterCommandReferences } from '../hooks/lib/command-filtration.js';
import type {
  AnalysisResult,
  CommandRule,
  SkillRule,
  SkillRulesConfig,
} from '../hooks/lib/types.js';

type SelectionLabel = 'critical' | 'promoted' | 'affinity' | 'dependency' | 'suggested';

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

interface RuntimeModules {
  analyzeIntent: (
    prompt: string,
    skills: Record<string, SkillRule>,
    commands?: Record<string, CommandRule>
  ) => Promise<AnalysisResult>;
  resolveSkillDependencies: (skills: string[], skillRules: Record<string, SkillRule>) => string[];
  filterAndPromoteSkills: (
    requiredSkills: string[],
    suggestedSkills: string[],
    acknowledgedSkills: string[],
    skillRules: Record<string, SkillRule>
  ) => { toInject: string[]; promoted: string[]; remainingSuggested: string[] };
  findAffinityInjections: (
    toInject: string[],
    acknowledged: string[],
    skillRules: Record<string, SkillRule>
  ) => string[];
  readAcknowledgedState: (
    stateDir: string,
    stateId: string
  ) => { acknowledgedSkills: string[]; acknowledgedCommands: string[] };
  writeSessionState: (
    stateDir: string,
    stateId: string,
    acknowledgedSkills: string[],
    injectedSkills: string[],
    acknowledgedCommands?: string[],
    injectedCommands?: string[]
  ) => void;
  debugLog: (message: string) => void;
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

let runtimeModulesPromise: Promise<RuntimeModules> | null = null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseNumberOption(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getProjectDirectory(): string {
  return process.env.OPENCODE_PROJECT_DIR || process.cwd();
}

function getPluginDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveStateDirectory(): Promise<string> {
  const projectDirectory = getProjectDirectory();
  const pluginDirectory = getPluginDirectory();
  const legacyStateDirectory = join(projectDirectory, '.claude', 'hooks', 'state');

  if (await fileExists(legacyStateDirectory)) {
    return legacyStateDirectory;
  }

  return join(pluginDirectory, 'state');
}

async function loadSkillRules(): Promise<SkillRulesConfig> {
  try {
    const rawRules = await readFile(SKILL_RULES_PATH, 'utf8');
    const parsedRules: unknown = JSON.parse(rawRules);

    if (!isRecord(parsedRules)) {
      debugLog(`Invalid skill-rules.json at ${SKILL_RULES_PATH}. Falling back to skill discovery.`);
      return buildSkillRulesFromSkills(SKILLS_DIR);
    }

    if (typeof parsedRules.version !== 'string' || !isRecord(parsedRules.skills)) {
      debugLog(`Invalid skill rules shape at ${SKILL_RULES_PATH}. Falling back to skill discovery.`);
      return buildSkillRulesFromSkills(SKILLS_DIR);
    }

    return {
      version: parsedRules.version,
      skills: parsedRules.skills as Record<string, SkillRule>,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`Failed to load ${SKILL_RULES_PATH}: ${message}. Falling back to skill discovery from ${SKILLS_DIR}.`);
    return buildSkillRulesFromSkills(SKILLS_DIR);
  }
}

function prepareRuntimeEnvironment(): void {
  // Preserve caller-provided environment values.
}

async function loadRuntimeModules(): Promise<RuntimeModules> {
  if (runtimeModulesPromise) {
    return runtimeModulesPromise;
  }

  runtimeModulesPromise = (async () => {
    const [intentAnalyzerModule, skillResolutionModule, skillFiltrationModule, stateModule, loggerModule] = await Promise.all([
      import('../hooks/lib/intent-analyzer.js'),
      import('../hooks/lib/skill-resolution.js'),
      import('../hooks/lib/skill-filtration.js'),
      import('../hooks/lib/skill-state-manager.js'),
      import('../hooks/lib/debug-logger.js'),
    ]);

    return {
      analyzeIntent: intentAnalyzerModule.analyzeIntent,
      resolveSkillDependencies: skillResolutionModule.resolveSkillDependencies,
      filterAndPromoteSkills: skillFiltrationModule.filterAndPromoteSkills,
      findAffinityInjections: skillFiltrationModule.findAffinityInjections,
      readAcknowledgedState: stateModule.readAcknowledgedState,
      writeSessionState: stateModule.writeSessionState,
      debugLog: loggerModule.debugLog,
    };
  })();

  return runtimeModulesPromise;
}

async function withConsoleSuppressed<T>(quiet: boolean, task: () => Promise<T>): Promise<T> {
  if (quiet) {
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = ((..._args: unknown[]) => undefined) as typeof console.error;
    console.warn = ((..._args: unknown[]) => undefined) as typeof console.warn;

    try {
      return await task();
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }
  }

  return task();
}

export function parseSelectionThreshold(optionThreshold: number | undefined): number {
  const defaultThreshold = parseNumberOption(process.env.SKILL_CONFIDENCE_THRESHOLD, 0.65);
  if (typeof optionThreshold === 'number' && Number.isFinite(optionThreshold)) {
    return optionThreshold;
  }

  return defaultThreshold;
}

function parseSuggestedThreshold(): number {
  return parseNumberOption(process.env.SKILL_SUGGESTED_THRESHOLD, 0.5);
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

function parseCommandThreshold(): number {
  return parseNumberOption(process.env.COMMAND_CONFIDENCE_THRESHOLD, 0.9);
}

function parseCommandSuggestedThreshold(requiredThreshold: number): number {
  return Math.min(
    parseNumberOption(process.env.COMMAND_SUGGESTED_THRESHOLD, 0.7),
    requiredThreshold
  );
}

function buildConfidenceBuckets(
  analysis: AnalysisResult,
  threshold: number
): { required: string[]; suggested: string[]; scores: Record<string, number> } {
  const scoreMap = analysis.scores ?? {};
  const candidateSkills = new Set<string>([
    ...analysis.required,
    ...analysis.suggested,
    ...Object.keys(scoreMap),
  ]);

  const suggestedFloor = Math.min(parseSuggestedThreshold(), threshold);
  const requiredSkills: string[] = [];
  const suggestedSkills: string[] = [];

  for (const skillName of candidateSkills) {
    const confidence = scoreMap[skillName];

    if (typeof confidence === 'number') {
      if (confidence >= threshold) {
        requiredSkills.push(skillName);
      } else if (confidence >= suggestedFloor) {
        suggestedSkills.push(skillName);
      }
      continue;
    }

    if (analysis.required.includes(skillName)) {
      requiredSkills.push(skillName);
      continue;
    }

    if (analysis.suggested.includes(skillName)) {
      suggestedSkills.push(skillName);
    }
  }

  return {
    required: Array.from(new Set(requiredSkills)),
    suggested: Array.from(new Set(suggestedSkills)),
    scores: scoreMap,
  };
}

function buildCommandConfidenceBuckets(
  analysis: AnalysisResult,
  threshold: number
): { required: string[]; suggested: string[]; scores: Record<string, number> } {
  const scoreMap = analysis.commandScores ?? {};
  const candidateCommands = new Set<string>([
    ...(analysis.requiredCommands ?? []),
    ...(analysis.suggestedCommands ?? []),
    ...Object.keys(scoreMap),
  ]);

  const suggestedFloor = parseCommandSuggestedThreshold(threshold);
  const requiredCommands: string[] = [];
  const suggestedCommands: string[] = [];

  for (const commandName of candidateCommands) {
    const confidence = scoreMap[commandName];

    if (typeof confidence === 'number') {
      if (confidence >= threshold) {
        requiredCommands.push(commandName);
      } else if (confidence >= suggestedFloor) {
        suggestedCommands.push(commandName);
      }
      continue;
    }

    if ((analysis.requiredCommands ?? []).includes(commandName)) {
      requiredCommands.push(commandName);
      continue;
    }

    if ((analysis.suggestedCommands ?? []).includes(commandName)) {
      suggestedCommands.push(commandName);
    }
  }

  return {
    required: Array.from(new Set(requiredCommands)),
    suggested: Array.from(new Set(suggestedCommands)),
    scores: scoreMap,
  };
}

function getSelectionLabel(
  skillName: string,
  requiredSkills: Set<string>,
  promotedSkills: Set<string>,
  affinitySkills: Set<string>
): SelectionLabel {
  if (requiredSkills.has(skillName)) {
    return 'critical';
  }

  if (promotedSkills.has(skillName)) {
    return 'promoted';
  }

  if (affinitySkills.has(skillName)) {
    return 'affinity';
  }

  return 'dependency';
}

export async function selectSkillsTool(input: SelectSkillsInput): Promise<SelectSkillsResult> {
  prepareRuntimeEnvironment();

  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    throw new Error('Invalid prompt: prompt must be a non-empty string.');
  }

  const projectDirectory = getProjectDirectory();
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
  const stateDirectory = await resolveStateDirectory();
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
    acknowledgedCommands
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
      writeMessage(createErrorResponse(null, -32603, message));
    });
  });
}

export async function main(): Promise<void> {
  prepareRuntimeEnvironment();
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

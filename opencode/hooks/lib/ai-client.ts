#!/usr/bin/env node
/**
 * Configurable AI provider client for intent analysis
 *
 * Supports Anthropic, OpenAI, and Ollama providers with a shared prompt
 * template and JSON parsing flow.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import {
  AI_TIMEOUT_MS,
  COMMAND_CONFIDENCE_THRESHOLD,
  COMMAND_SUGGESTED_THRESHOLD,
  CONFIDENCE_THRESHOLD,
  MAX_REQUIRED_COMMANDS,
  MAX_REQUIRED_SKILLS,
  MIN_AI_CALL_INTERVAL_MS,
  SUGGESTED_THRESHOLD,
} from './constants.js';
import { debugLog } from './debug-logger.js';
import type { CommandRule, IntentAnalysis, SkillRule } from './types.js';

export type AIProvider = 'anthropic' | 'openai' | 'ollama';

function validateOllamaUrl(urlString: string, isExplicitlySet: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid OLLAMA_BASE_URL: ${urlString}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol for Ollama URL: ${parsed.protocol}`);
  }
  if (!isExplicitlySet) {
    return urlString;  // Default localhost is safe
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const restrictedPatterns = [
    /^169\.254\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^localhost$/i,
  ];
  for (const pattern of restrictedPatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`OLLAMA_BASE_URL points to a restricted address: ${hostname}`);
    }
  }
  return urlString;
}

interface ApiKeyCredential {
  apiKey: string;
  source: 'environment' | 'opencode-auth';
}

export function getProvider(): AIProvider {
  const provider = process.env.OPENCODE_SKILLS_PROVIDER?.toLowerCase();

  if (provider === 'anthropic' || provider === 'openai' || provider === 'ollama') {
    return provider;
  }

  return 'anthropic';
}

export function getModel(provider: AIProvider): string {
  const configuredModel = process.env.OPENCODE_SKILLS_MODEL;

  if (configuredModel) {
    const providerPrefix = `${provider}/`;
    return configuredModel.startsWith(providerPrefix)
      ? configuredModel.slice(providerPrefix.length)
      : configuredModel;
  }

  if (provider === 'openai') {
    return 'gpt-4o-mini';
  }

  if (provider === 'ollama') {
    return 'llama3.1';
  }

  return 'claude-haiku-4-5';
}

function getOpenCodeAuthPathCandidates(): string[] {
  const candidates: string[] = [];

  if (process.env.OPENCODE_AUTH_PATH) {
    candidates.push(process.env.OPENCODE_AUTH_PATH);
  }

  if (process.env.XDG_DATA_HOME) {
    candidates.push(join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json'));
  }

  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      candidates.push(join(process.env.APPDATA, 'opencode', 'auth.json'));
    }
    candidates.push(join(homedir(), 'AppData', 'Roaming', 'opencode', 'auth.json'));
  }

  candidates.push(join(homedir(), '.local', 'share', 'opencode', 'auth.json'));

  return Array.from(new Set(candidates));
}

function readOpenCodeApiKey(provider: 'anthropic' | 'openai'): string | undefined {
  for (const authPath of getOpenCodeAuthPathCandidates()) {
    if (!existsSync(authPath)) {
      continue;
    }

    try {
      const authStore = JSON.parse(readFileSync(authPath, 'utf-8')) as Record<
        string,
        { type?: unknown; key?: unknown }
      >;
      const providerCredential = authStore[provider];

      if (providerCredential?.type === 'api' && typeof providerCredential.key === 'string') {
        const key = providerCredential.key.trim();
        if (key.length > 0) {
          return key;
        }
      }
    } catch (error) {
      debugLog(`ai-client: failed to parse auth file ${authPath}: ${String(error)}`);
      continue;
    }
  }

  return undefined;
}

function getAnthropicApiKey(): ApiKeyCredential | undefined {
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) {
    return { apiKey: envKey, source: 'environment' };
  }

  const authKey = readOpenCodeApiKey('anthropic');
  if (authKey) {
    return { apiKey: authKey, source: 'opencode-auth' };
  }

  return undefined;
}

// Project-directory prompt templates are trusted by design — the project owner controls this path.
export function getPromptTemplate(): string {
  const projectDir = process.env.OPENCODE_PROJECT_DIR || process.cwd();
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const promptPaths = [
    join(projectDir, '.claude', 'hooks', 'config', 'intent-analysis-prompt.txt'),
    join(projectDir, 'hooks', 'config', 'intent-analysis-prompt.txt'),
    join(
      projectDir,
      'opencode',
      'hooks',
      'config',
      'intent-analysis-prompt.txt'
    ),
    resolve(moduleDir, '..', 'config', 'intent-analysis-prompt.txt'),
    resolve(moduleDir, '..', '..', '..', 'hooks', 'config', 'intent-analysis-prompt.txt'),
  ];

  for (const promptPath of promptPaths) {
    if (existsSync(promptPath)) {
      return readFileSync(promptPath, 'utf-8');
    }
  }

  throw new Error(
    `Intent analysis prompt template not found. Expected one of: ${promptPaths.join(', ')}.`
  );
}

function buildSkillDescriptions(skills: Record<string, SkillRule>): string {
  return Object.entries(skills)
    .map(([skillName, skillRule]) => {
      const description = skillRule.description || 'No description provided.';
      return `- ${skillName}: ${description}`;
    })
    .join('\n');
}

function buildCommandDescriptions(commands: Record<string, CommandRule>): string {
  const MAX_DESCRIPTION_CHARS = 180;
  const MAX_SUMMARY_CHARS = 320;
  const MAX_LINE_CHARS = 560;
  const MAX_TOTAL_CHARS = 25000;

  const sanitizeText = (text: string): string =>
    text
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const truncate = (text: string, maxChars: number): string => {
    if (text.length <= maxChars) return text;
    const truncated = text.slice(0, maxChars).trimEnd();
    return /[.!?]$/.test(truncated) ? truncated : `${truncated}...`;
  };

  const lines: string[] = [];
  let totalChars = 0;
  let truncatedCount = 0;

  for (const [commandName, commandRule] of Object.entries(commands)) {
      const description = truncate(
        sanitizeText(commandRule.description || 'No description provided.'),
        MAX_DESCRIPTION_CHARS
      );
      const workflowPhase = commandRule.workflowPhase
        ? ` Workflow phase: ${sanitizeText(commandRule.workflowPhase)}.`
        : '';
      const summaryText = commandRule.summary
        ? truncate(sanitizeText(commandRule.summary), MAX_SUMMARY_CHARS)
        : '';
      const summary = summaryText ? ` Summary: ${summaryText}.` : '';
      const line = truncate(
        `- ${sanitizeText(commandName)}: ${description}.${workflowPhase}${summary}`,
        MAX_LINE_CHARS
      );

      if (totalChars + line.length > MAX_TOTAL_CHARS) {
        truncatedCount = Object.keys(commands).length - lines.length;
        break;
      }

      lines.push(line);
      totalChars += line.length + 1;
  }

  if (truncatedCount > 0) {
    const truncationNoticePrefix = '- NOTE: Command references truncated due to prompt budget.';
    let notice = `${truncationNoticePrefix} Omitted ${truncatedCount} command reference(s).`;
    while (lines.length > 0 && totalChars + notice.length + 1 > MAX_TOTAL_CHARS) {
      const removedLine = lines.pop();
      if (!removedLine) break;
      totalChars -= removedLine.length + 1;
      truncatedCount += 1;
      notice = `${truncationNoticePrefix} Omitted ${truncatedCount} command reference(s).`;
    }

    lines.push(notice);
    debugLog(
      `intent-ai-client: truncated command descriptions for prompt budget included=${lines.length} omitted=${truncatedCount} maxTotalChars=${MAX_TOTAL_CHARS}`
    );
  }

  return lines.join('\n');
}

function formatThreshold(value: number): string {
  return value.toFixed(2);
}

const MAX_USER_PROMPT_LENGTH = 50000;

/**
 * Returns the raw user prompt for use as the user-message content.
 * Validates length to prevent oversized inputs.
 *
 * @throws {Error} if the prompt exceeds MAX_USER_PROMPT_LENGTH characters
 */
export function getUserPromptContent(prompt: string): string {
  if (prompt.length > MAX_USER_PROMPT_LENGTH) {
    throw new Error(
      `User prompt exceeds maximum length of ${MAX_USER_PROMPT_LENGTH.toLocaleString()} characters`
    );
  }
  return prompt;
}

/**
 * Builds the system/instruction portion of the intent analysis prompt.
 * User content is NOT embedded here — it is sent as a separate user message
 * to prevent prompt injection attacks.
 *
 * For backward compatibility the function still accepts an optional leading
 * `prompt` string as the first argument, but that value is ignored.
 */
export function buildPrompt(
  _promptOrSkills: string | Record<string, SkillRule>,
  skillsOrCommands?: Record<string, SkillRule> | Record<string, CommandRule>,
  commandsArg: Record<string, CommandRule> = {}
): string {
  // Resolve overloaded arguments:
  //   Legacy:  buildPrompt(userPrompt, skills, commands)
  //   Current: buildPrompt(skills, commands)
  let skills: Record<string, SkillRule>;
  let commands: Record<string, CommandRule>;

  if (typeof _promptOrSkills === 'string') {
    // Legacy three-argument call — first arg was the user prompt (now ignored)
    skills = (skillsOrCommands ?? {}) as Record<string, SkillRule>;
    commands = commandsArg;
  } else {
    // Two-argument call — first arg is skills
    skills = _promptOrSkills;
    commands = (skillsOrCommands ?? {}) as Record<string, CommandRule>;
  }

  const promptTemplate = getPromptTemplate();
  const commandDescriptions = buildCommandDescriptions(commands);
  const renderedPrompt = promptTemplate
    .replace(/\{\{USER_PROMPT\}\}/g, '')
    .replace(/\{\{SKILL_DESCRIPTIONS\}\}/g, () => buildSkillDescriptions(skills))
    .replace(/\{\{COMMAND_DESCRIPTIONS\}\}/g, () => commandDescriptions)
    .replace(/\{\{SKILL_REQUIRED_THRESHOLD\}\}/g, () => formatThreshold(CONFIDENCE_THRESHOLD))
    .replace(/\{\{SKILL_SUGGESTED_THRESHOLD\}\}/g, () => formatThreshold(SUGGESTED_THRESHOLD))
    .replace(/\{\{COMMAND_REQUIRED_THRESHOLD\}\}/g, () =>
      formatThreshold(COMMAND_CONFIDENCE_THRESHOLD)
    )
    .replace(/\{\{COMMAND_SUGGESTED_THRESHOLD\}\}/g, () =>
      formatThreshold(COMMAND_SUGGESTED_THRESHOLD)
    )
    .replace(/\{\{MAX_REQUIRED_SKILLS\}\}/g, () => String(MAX_REQUIRED_SKILLS))
    .replace(/\{\{MAX_REQUIRED_COMMANDS\}\}/g, () => String(MAX_REQUIRED_COMMANDS));

  if (promptTemplate.includes('{{COMMAND_DESCRIPTIONS}}')) {
    return renderedPrompt;
  }

  if (Object.keys(commands).length === 0) {
    return renderedPrompt;
  }

  return `${renderedPrompt}\n\nAvailable commands:\n${commandDescriptions}`;
}

function stripMarkdownFences(content: string): string {
  const trimmedContent = content.trim();

  if (!trimmedContent.startsWith('```')) {
    return trimmedContent;
  }

  const lines = trimmedContent.split('\n');

  if (lines.length > 0 && lines[0].startsWith('```')) {
    lines.shift();
  }

  if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) {
    lines.pop();
  }

  return lines.join('\n').trim();
}

export function parseIntentAnalysis(content: string): IntentAnalysis {
  const parsedContent = stripMarkdownFences(content);

  // Fallback: extract JSON object from text that may contain preamble
  const jsonMatch = parsedContent.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : parsedContent;

  try {
    const parsedValue: unknown = JSON.parse(jsonText);

    if (
      typeof parsedValue !== 'object' ||
      parsedValue === null ||
      !('primary_intent' in parsedValue) ||
      !('skills' in parsedValue)
    ) {
      throw new Error('Missing primary_intent or skills fields.');
    }

    const candidateAnalysis = parsedValue as {
      primary_intent: unknown;
      skills: unknown;
      skill_rankings?: unknown;
      commands?: unknown;
    };

    if (typeof candidateAnalysis.primary_intent !== 'string') {
      throw new Error('primary_intent must be a string.');
    }

    if (!Array.isArray(candidateAnalysis.skills)) {
      throw new Error('skills must be an array.');
    }

    const skills = candidateAnalysis.skills.map((skillEntry) => {
      if (typeof skillEntry !== 'object' || skillEntry === null) {
        throw new Error('Each skill entry must be an object.');
      }

      const candidateSkill = skillEntry as {
        name: unknown;
        confidence: unknown;
        reason: unknown;
      };

      if (
        typeof candidateSkill.name !== 'string' ||
        typeof candidateSkill.confidence !== 'number' ||
        typeof candidateSkill.reason !== 'string'
      ) {
        throw new Error('Each skill entry must include name, confidence, and reason fields.');
      }

      return {
        name: candidateSkill.name.replace(/\s*\((?:domain|guardrail)\)\s*$/i, '').trim(),
        confidence: Math.max(0, Math.min(1, candidateSkill.confidence)),
        reason: candidateSkill.reason,
      };
    });

    let skillRankings: { name: string; confidence: number; reason?: string }[] | undefined;
    if (candidateAnalysis.skill_rankings !== undefined) {
      if (!Array.isArray(candidateAnalysis.skill_rankings)) {
        throw new Error('skill_rankings must be an array when provided.');
      }

      skillRankings = candidateAnalysis.skill_rankings.map((rankingEntry) => {
        if (typeof rankingEntry !== 'object' || rankingEntry === null) {
          throw new Error('Each skill ranking entry must be an object.');
        }

        const candidateRanking = rankingEntry as {
          name: unknown;
          confidence: unknown;
          reason?: unknown;
        };

        if (
          typeof candidateRanking.name !== 'string' ||
          typeof candidateRanking.confidence !== 'number'
        ) {
          throw new Error('Each skill ranking entry must include name and confidence fields.');
        }

        return {
          name: candidateRanking.name.replace(/\s*\((?:domain|guardrail)\)\s*$/i, '').trim(),
          confidence: Math.max(0, Math.min(1, candidateRanking.confidence)),
          ...(typeof candidateRanking.reason === 'string' ? { reason: candidateRanking.reason } : {}),
        };
      });
    }

    let commands: { name: string; confidence: number; reason: string }[] = [];
    if (candidateAnalysis.commands !== undefined) {
      if (!Array.isArray(candidateAnalysis.commands)) {
        throw new Error('commands must be an array when provided.');
      }

      commands = candidateAnalysis.commands.map((commandEntry) => {
        if (typeof commandEntry !== 'object' || commandEntry === null) {
          throw new Error('Each command entry must be an object.');
        }

        const candidateCommand = commandEntry as {
          name: unknown;
          confidence: unknown;
          reason: unknown;
        };

        if (
          typeof candidateCommand.name !== 'string' ||
          typeof candidateCommand.confidence !== 'number' ||
          typeof candidateCommand.reason !== 'string'
        ) {
          throw new Error('Each command entry must include name, confidence, and reason fields.');
        }

        return {
          name: candidateCommand.name.trim(),
          confidence: Math.max(0, Math.min(1, candidateCommand.confidence)),
          reason: candidateCommand.reason,
        };
      });
    }

    return {
      primary_intent: candidateAnalysis.primary_intent,
      skills,
      ...(skillRankings ? { skill_rankings: skillRankings } : {}),
      commands,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse intent analysis response: ${message}`);
  }
}

async function callAnthropicIntentAnalysis(
  systemPrompt: string,
  userPrompt: string
): Promise<IntentAnalysis> {
  const credential = getAnthropicApiKey();

  if (!credential) {
    throw new Error(
      'Missing Anthropic API key. Set ANTHROPIC_API_KEY or add Anthropic API credentials to OpenCode auth.'
    );
  }

  let anthropicModule: typeof import('@anthropic-ai/sdk');

  try {
    anthropicModule = await import('@anthropic-ai/sdk');
  } catch {
    throw new Error(
      'Anthropic provider package "@anthropic-ai/sdk" is not installed. Install it with `npm install @anthropic-ai/sdk` or select a different provider.'
    );
  }

  const AnthropicClient = anthropicModule.default;
  const client = new AnthropicClient({ apiKey: credential.apiKey, timeout: AI_TIMEOUT_MS });
  const model = getModel('anthropic');
  debugLog(`intent analysis provider=anthropic model=${model} authSource=${credential.source}`);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 10000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
      .trim();

    if (!responseText) {
      throw new Error('Anthropic returned an empty response.');
    }

    return parseIntentAnalysis(responseText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Anthropic intent analysis failed: ${message}`);
  }
}

async function callOpenAIIntentAnalysis(
  systemPrompt: string,
  userPrompt: string
): Promise<IntentAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Missing OPENAI_API_KEY. Set OPENAI_API_KEY to use OpenAI, or choose OPENCODE_SKILLS_PROVIDER=anthropic with ANTHROPIC_API_KEY, or OPENCODE_SKILLS_PROVIDER=ollama for local inference.'
    );
  }

  let openaiModule: typeof import('openai');

  try {
    openaiModule = await import('openai');
  } catch {
    throw new Error(
      'OpenAI provider package "openai" is not installed. Install it with `npm install openai` or select a different provider.'
    );
  }

  const OpenAIClient = openaiModule.default;
  const client = new OpenAIClient({ apiKey });
  const model = getModel('openai');

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });

    const messageContent = response.choices[0]?.message?.content;
    const responseText = Array.isArray(messageContent)
      ? messageContent
          .map((part) => ('text' in part ? part.text : ''))
          .join('')
          .trim()
      : typeof messageContent === 'string'
        ? messageContent.trim()
        : '';

    if (!responseText) {
      throw new Error('OpenAI returned an empty response.');
    }

    return parseIntentAnalysis(responseText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI intent analysis failed: ${message}`);
  }
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

async function callOllamaIntentAnalysis(
  systemPrompt: string,
  userPrompt: string
): Promise<IntentAnalysis> {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available. Use Node.js 18+ or provide a fetch polyfill.');
  }

  const rawUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const isExplicitlySet = Boolean(process.env.OLLAMA_BASE_URL);
  const baseUrl = validateOllamaUrl(rawUrl.replace(/\/+$/, ''), isExplicitlySet);
  const model = getModel('ollama');

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const suffix = errorText ? ` - ${errorText}` : '';
      throw new Error(`HTTP ${response.status} ${response.statusText}${suffix}`);
    }

    const responseBody = (await response.json()) as OllamaGenerateResponse;

    if (typeof responseBody.response !== 'string' || responseBody.response.trim().length === 0) {
      throw new Error(responseBody.error || 'Ollama returned an empty response.');
    }

    return parseIntentAnalysis(responseBody.response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Ollama intent analysis failed: ${message}`);
  }
}

let lastAICallTimestamp = 0;

/** Reset the rate-limiter timestamp (for testing only). */
export function _resetRateLimiter(): void {
  lastAICallTimestamp = 0;
}

export async function callAIForIntentAnalysis(
  prompt: string,
  skills: Record<string, SkillRule>,
  commands: Record<string, CommandRule> = {}
): Promise<IntentAnalysis> {
  if (Date.now() - lastAICallTimestamp < MIN_AI_CALL_INTERVAL_MS) {
    debugLog('ai-client: rate limited, skipping AI call');
    return { primary_intent: '', skills: [], commands: [] };
  }
  lastAICallTimestamp = Date.now();

  const provider = getProvider();
  const systemPrompt = buildPrompt(skills, commands);
  const userPrompt = getUserPromptContent(prompt);

  if (provider === 'openai') {
    return callOpenAIIntentAnalysis(systemPrompt, userPrompt);
  }

  if (provider === 'ollama') {
    return callOllamaIntentAnalysis(systemPrompt, userPrompt);
  }

  return callAnthropicIntentAnalysis(systemPrompt, userPrompt);
}

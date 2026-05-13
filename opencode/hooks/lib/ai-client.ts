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
import { debugLog } from './debug-logger.js';
import type { CommandRule, IntentAnalysis, SkillRule } from './types.js';

export type AIProvider = 'anthropic' | 'openai' | 'ollama';

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
    } catch {
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
  const sanitizeName = (name: string): string =>
    name
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  return Object.entries(commands)
    .map(([commandName, commandRule]) => {
      const description = commandRule.description || 'No description provided.';
      return `- ${sanitizeName(commandName)}: ${description}`;
    })
    .join('\n');
}

export function buildPrompt(
  prompt: string,
  skills: Record<string, SkillRule>,
  commands: Record<string, CommandRule> = {}
): string {
  const promptTemplate = getPromptTemplate();
  const commandDescriptions = buildCommandDescriptions(commands);
  const renderedPrompt = promptTemplate
    .replace(/\{\{USER_PROMPT\}\}/g, () => prompt)
    .replace(/\{\{SKILL_DESCRIPTIONS\}\}/g, () => buildSkillDescriptions(skills))
    .replace(/\{\{COMMAND_DESCRIPTIONS\}\}/g, () => commandDescriptions);

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
        confidence: candidateSkill.confidence,
        reason: candidateSkill.reason,
      };
    });

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
          confidence: candidateCommand.confidence,
          reason: candidateCommand.reason,
        };
      });
    }

    return {
      primary_intent: candidateAnalysis.primary_intent,
      skills,
      commands,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse intent analysis response: ${message}`);
  }
}

async function callAnthropicIntentAnalysis(prompt: string): Promise<IntentAnalysis> {
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
  const client = new AnthropicClient({ apiKey: credential.apiKey });
  const model = getModel('anthropic');
  debugLog(`intent analysis provider=anthropic model=${model} authSource=${credential.source}`);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
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

async function callOpenAIIntentAnalysis(prompt: string): Promise<IntentAnalysis> {
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
      messages: [{ role: 'user', content: prompt }],
    });

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

async function callOllamaIntentAnalysis(prompt: string): Promise<IntentAnalysis> {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available. Use Node.js 18+ or provide a fetch polyfill.');
  }

  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const model = getModel('ollama');

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
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

export async function callAIForIntentAnalysis(
  prompt: string,
  skills: Record<string, SkillRule>,
  commands: Record<string, CommandRule> = {}
): Promise<IntentAnalysis> {
  const provider = getProvider();
  const analysisPrompt = buildPrompt(prompt, skills, commands);

  if (provider === 'openai') {
    return callOpenAIIntentAnalysis(analysisPrompt);
  }

  if (provider === 'ollama') {
    return callOllamaIntentAnalysis(analysisPrompt);
  }

  return callAnthropicIntentAnalysis(analysisPrompt);
}

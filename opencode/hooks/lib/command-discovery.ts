/**
 * Command discovery from OpenCode config and markdown command directories.
 */

import { existsSync, readdirSync, readFileSync, statSync, lstatSync, realpathSync } from 'fs';
import { extname, join, basename, resolve, relative } from 'path';
import { debugLog } from './debug-logger.js';
import { getWorkflowPhaseForCommand } from './command-phase-map.js';
import type { CommandRule } from './types.js';

interface CommandDiscoveryOptions {
  configPath?: string;
  commandsDirs?: string[];
}

const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const RESERVED_COMMAND_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SUMMARY_MAX_LENGTH = 320;
const SUMMARY_BODY_CHAR_LIMIT = 1600;
const COMMON_INLINE_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+[A-Za-z0-9:_./-]+|test(?:\s+[A-Za-z0-9:_./-]+)?|build(?:\s+[A-Za-z0-9:_./-]+)?|install(?:\s+[A-Za-z0-9:_./-]+)?|add\s+[A-Za-z0-9@:_./-]+|audit(?:\s+[A-Za-z0-9:_./-]+)?|exec\s+[A-Za-z0-9:_./-]+|lint(?:\s+[A-Za-z0-9:_./-]+)?|ci(?:\s+[A-Za-z0-9:_./-]+)?)(?=$|[\s.,;:!?()])/gi,
  /\b(?:npx|bunx)\s+(?:tsx|tsc|eslint|vitest|[A-Za-z0-9:_./-]+)(?:\s+[A-Za-z0-9@:_./=-]+){0,5}(?=$|[\s.,;:!?()])/gi,
  /\btsx\s+[A-Za-z0-9._/@:-]+(?:\s+[A-Za-z0-9@:_./=-]+){0,5}(?=$|[\s.,;:!?()])/gi,
  /\btsc\s+(?:--[A-Za-z0-9-]+(?:=[A-Za-z0-9._/-]+)?\s*)+(?=$|[\s.,;:!?()])/gi,
  /\beslint\s+(?:--[A-Za-z0-9-]+(?:=[A-Za-z0-9._/-]+)?(?:\s+[A-Za-z0-9@:_./=-]+){0,4}|(?:\.{1,2}\/|\/|~\/)[A-Za-z0-9@:_./*=-]+(?:\s+[A-Za-z0-9@:_./=-]+){0,4}|\.(?:\s+[A-Za-z0-9@:_./=-]+){0,4}|[A-Za-z0-9*_-]+\.(?:js|jsx|ts|tsx|mjs|cjs|vue|svelte)(?:\s+[A-Za-z0-9@:_./=-]+){0,4})(?=$|[\s.,;:!?()])/gi,
  /\bvitest\s+(?:run|watch|related|bench|typecheck)(?:\s+[A-Za-z0-9@:_./=-]+){0,5}(?=$|[\s.,;:!?()])/gi,
  /\bcargo\s+(?:build|test|check|fmt|clippy|run|bench|clean|update|doc)(?:\s+[A-Za-z0-9:_./=-]+){0,3}(?=$|[\s.,;:!?()])/gi,
  /\bgo\s+(?:test|build|vet|fmt|mod|mod\s+tidy|get|run|list)(?:\s+[A-Za-z0-9:_./=-]+){0,4}(?=$|[\s.,;:!?()])/gi,
  /\bgit\s+(?:status|diff|commit|push|pull|checkout|switch|merge|rebase|log|add|fetch|stash|reset)(?:\s+[A-Za-z0-9:_./=-]+){0,4}(?=$|[\s.,;:!?()])/gi,
  /\bdocker\s+(?:build|run|compose|ps|pull|push|exec|logs|images|tag|stop|start)(?:\s+[A-Za-z0-9:_./=-]+){0,4}(?=$|[\s.,;:!?()])/gi,
  /\bkubectl\s+(?:apply|get|describe|logs|delete|exec|port-forward|config|rollout|scale)(?:\s+[A-Za-z0-9:_./=-]+){0,4}(?=$|[\s.,;:!?()])/gi,
  /\bpython\s+(?:-m\s+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.py)(?:\s+[A-Za-z0-9:_./=-]+){0,3}(?=$|[\s.,;:!?()])/gi,
  /\bpip\s+(?:install|uninstall|freeze|list|show|check|wheel)(?:\s+[A-Za-z0-9@:_./=-]+){0,4}(?=$|[\s.,;:!?()])/gi,
  /\bnode\s+(?:[A-Za-z0-9_.-]+\.js|-e\s+["'][^"']+["'])(?:\s+[A-Za-z0-9:_./=-]+){0,3}(?=$|[\s.,;:!?()])/gi,
  /\bmake\s+(?:build|test|lint|check|install|clean|dev|release|verify|all)(?:\s+[A-Za-z0-9:_./=-]+){0,3}(?=$|[\s.,;:!?()])/gi,
];
const LINE_COMMAND_PREFIX_PATTERNS = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+[A-Za-z0-9:_./-]+|test(?:\s+[A-Za-z0-9:_./-]+)?|build(?:\s+[A-Za-z0-9:_./-]+)?|install(?:\s+[A-Za-z0-9:_./-]+)?|add\s+[A-Za-z0-9@:_./-]+|audit(?:\s+[A-Za-z0-9:_./-]+)?|exec\s+[A-Za-z0-9:_./-]+|lint(?:\s+[A-Za-z0-9:_./-]+)?|ci(?:\s+[A-Za-z0-9:_./-]+)?)(?:\s|$)/i,
  /^(?:npx|bunx)\s+(?:tsx|tsc|eslint|vitest|[A-Za-z0-9:_./-]+)(?:\s|$)/i,
  /^tsx\s+[A-Za-z0-9._/@:-]+(?:\s|$)/i,
  /^tsc\s+(?:--[A-Za-z0-9-]+(?:=[A-Za-z0-9._/-]+)?)(?:\s|$)/i,
  /^eslint\s+(?:--[A-Za-z0-9-]+(?:=[A-Za-z0-9._/-]+)?|(?:\.{1,2}\/|\/|~\/)[A-Za-z0-9@:_./*=-]+|\.|[A-Za-z0-9*_-]+\.(?:js|jsx|ts|tsx|mjs|cjs|vue|svelte))(?:\s|$)/i,
  /^vitest\s+(?:run|watch|related|bench|typecheck)(?:\s|$)/i,
  /^cargo\s+(?:build|test|check|fmt|clippy|run|bench|clean|update|doc)(?:\s|$)/i,
  /^go\s+(?:test|build|vet|fmt|mod|mod\s+tidy|get|run|list)(?:\s|$)/i,
  /^git\s+(?:status|diff|commit|push|pull|checkout|switch|merge|rebase|log|add|fetch|stash|reset)(?:\s|$)/i,
  /^docker\s+(?:build|run|compose|ps|pull|push|exec|logs|images|tag|stop|start)(?:\s|$)/i,
  /^kubectl\s+(?:apply|get|describe|logs|delete|exec|port-forward|config|rollout|scale)(?:\s|$)/i,
  /^python\s+(?:-m\s+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.py)(?:\s|$)/i,
  /^pip\s+(?:install|uninstall|freeze|list|show|check|wheel)(?:\s|$)/i,
  /^node\s+(?:[A-Za-z0-9_.-]+\.js|-e\s+["'][^"']+["'])(?:\s|$)/i,
  /^make\s+(?:build|test|lint|check|install|clean|dev|release|verify|all)(?:\s|$)/i,
];

export function isValidCommandName(commandName: string): boolean {
  if (typeof commandName !== 'string') return false;
  if (commandName.length === 0 || commandName.length > 120) return false;
  if (!COMMAND_NAME_PATTERN.test(commandName)) return false;
  if (/[\s\r\n\t]/.test(commandName)) return false;
  if (RESERVED_COMMAND_KEYS.has(commandName)) return false;
  return true;
}

function stripJsonComments(jsonText: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < jsonText.length; i += 1) {
    const ch = jsonText[i];
    const next = i + 1 < jsonText.length ? jsonText[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        result += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    result += ch;
  }

  return result;
}

function stripTrailingCommas(jsonText: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonText.length; i += 1) {
    const ch = jsonText[i];

    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }

    if (ch === ',') {
      let j = i + 1;
      while (j < jsonText.length && /\s/.test(jsonText[j])) {
        j += 1;
      }

      if (j < jsonText.length && (jsonText[j] === '}' || jsonText[j] === ']')) {
        continue;
      }
    }

    result += ch;
  }

  return result;
}

export function parseJsoncLike(jsonText: string): unknown {
  const withoutComments = stripJsonComments(jsonText);
  const withoutTrailingCommas = stripTrailingCommas(withoutComments);
  return JSON.parse(withoutTrailingCommas);
}

export function resolveCommandDiscoveryOptions(projectDirectory: string): CommandDiscoveryOptions {
  const envConfigPath =
    process.env.OPENCODE_CONFIG_PATH?.trim() ||
    process.env.OPENCODE_COMMAND_CONFIG_PATH?.trim();
  const envCommandsDirs =
    process.env.OPENCODE_COMMANDS_DIR?.trim() ||
    process.env.OPENCODE_COMMANDS_DIRS?.trim();

  const configPath =
    envConfigPath && envConfigPath.length > 0
      ? envConfigPath
      : join(projectDirectory, 'opencode.json');

  const commandsDirs = [
    ...(envCommandsDirs
      ? envCommandsDirs
          .split(/[;,]/g)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : []),
    join(projectDirectory, 'commands'),
    join(projectDirectory, '.opencode', 'commands'),
  ];

  return {
    configPath,
    commandsDirs: Array.from(new Set(commandsDirs)),
  };
}

function parseFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }

  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: trimmed };
  }

  const [, frontmatterText, body] = match;
  const frontmatter: Record<string, unknown> = Object.create(null);
  for (const line of frontmatterText.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (rawValue === 'true') {
      frontmatter[key] = true;
    } else if (rawValue === 'false') {
      frontmatter[key] = false;
    } else {
      frontmatter[key] = rawValue;
    }
  }

  return { frontmatter, body: body.trim() };
}

function parseStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }

  if (typeof value === 'string') {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }

  return undefined;
}

function parseCommandType(value: unknown): 'guardrail' | 'domain' | undefined {
  return value === 'guardrail' || value === 'domain' ? value : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parsePromptTriggerKeywords(source: Record<string, unknown>): string[] | undefined {
  const promptTriggers = source.promptTriggers;
  if (
    typeof promptTriggers === 'object' &&
    promptTriggers !== null &&
    !Array.isArray(promptTriggers)
  ) {
    const keywords = parseStringList(
      (promptTriggers as Record<string, unknown>).keywords
    );
    if (keywords) return keywords;
  }

  return (
    parseStringList(source['promptTriggers.keywords']) ||
    parseStringList(source.keywords)
  );
}

function sanitizeSummaryText(text: string): string {
  let sanitized = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/(^|\s)\$ARGUMENTS(\s|$)/gi, ' ')
    .replace(/(^|\s)![A-Za-z0-9._/-]+/g, ' ')
    .replace(/(^|\s)@(?:file|files|argument|arguments|arg|args|input|output|context|prompt)\b[^\s]*/gi, ' ')
    .replace(/(^|\s)@(?:\.{1,2}\/|\/|~\/|[A-Za-z]:\\)[^\s]+/g, ' ')
    .replace(/\b(?:https?|file):\/\/[^\s]+/gi, ' ')
    .replace(/\b[A-Za-z]:\\[^\s]+/g, ' ')
    .replace(/(^|\s)(?:\.{1,2}\/|\/|~\/)[^\s]+/g, ' ')
    .replace(/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const pattern of COMMON_INLINE_COMMAND_PATTERNS) {
    sanitized = sanitized.replace(pattern, ' ');
  }

  return sanitized.replace(/\s+/g, ' ').trim();
}

function looksLikeShellOrTemplateLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^-{3,}$/.test(trimmed)) return true;
  if (trimmed.startsWith('```')) return true;
  if (trimmed.startsWith('!')) return true;
  if (/\$ARGUMENTS/i.test(trimmed)) return true;
  if (/^[@$]/.test(trimmed)) return true;
  if (LINE_COMMAND_PREFIX_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  if (/^[A-Za-z]:\\/.test(trimmed) || /^(\/|\.{1,2}\/)/.test(trimmed)) return true;
  if (/^[#>*-]{1,3}\s*`/.test(trimmed)) return true;
  if (/^[a-z0-9_.-]+\.(md|ts|tsx|js|jsx|json|yaml|yml|py|rs|go)(:\d+)?$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function stripCommonListPrefix(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
}

function collectMeaningfulBodyText(markdownBody: string): string {
  const truncatedBody = markdownBody.slice(0, SUMMARY_BODY_CHAR_LIMIT);
  const lines = truncatedBody.split(/\r?\n/);
  const selected: string[] = [];
  let insideFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const normalizedLine = stripCommonListPrefix(line).replace(/^#+\s*/, '').trim();
    if (looksLikeShellOrTemplateLine(normalizedLine)) continue;
    selected.push(normalizedLine);
    if (selected.join(' ').length >= SUMMARY_MAX_LENGTH) break;
    if (selected.length >= 3) break;
  }

  return selected.join(' ');
}

function buildCommandSummary(params: {
  explicitSummary?: string;
  template: string;
}): string | undefined {
  const { explicitSummary, template } = params;
  const fallbackSource = collectMeaningfulBodyText(template);
  const prioritizedSource =
    typeof explicitSummary === 'string' && explicitSummary.trim().length > 0
      ? explicitSummary
      : fallbackSource;

  let summary = sanitizeSummaryText(prioritizedSource);
  if (!summary && prioritizedSource !== fallbackSource) {
    summary = sanitizeSummaryText(fallbackSource);
  }
  if (!summary) return undefined;

  if (summary.length > SUMMARY_MAX_LENGTH) {
    summary = summary.slice(0, SUMMARY_MAX_LENGTH).trimEnd();
    if (!/[.!?]$/.test(summary)) summary += '...';
  }
  return summary;
}

export function buildCommandRuleFromMarkdown(
  commandName: string,
  markdown: string,
  sourcePath: string
): CommandRule {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const promptTriggerKeywords = parsePromptTriggerKeywords(frontmatter);
  const description =
    typeof frontmatter.description === 'string'
      ? frontmatter.description
      : `Command ${commandName}`;
  const workflowPhase = getWorkflowPhaseForCommand(commandName);
  const summary = buildCommandSummary({
    explicitSummary: typeof frontmatter.summary === 'string' ? frontmatter.summary : undefined,
    template: body,
  });

  return {
    type: parseCommandType(frontmatter.type),
    description,
    summary,
    workflowPhase,
    template: body,
    autoInject: typeof frontmatter.autoInject === 'boolean' ? frontmatter.autoInject : undefined,
    requiredCommands: parseStringList(frontmatter.requiredCommands),
    injectionOrder: parseNumber(frontmatter.injectionOrder),
    promptTriggers: promptTriggerKeywords ? { keywords: promptTriggerKeywords } : undefined,
    agent: typeof frontmatter.agent === 'string' ? frontmatter.agent : undefined,
    subtask: typeof frontmatter.subtask === 'boolean' ? frontmatter.subtask : undefined,
    model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
    source: 'markdown',
    sourcePath,
  };
}

export function discoverCommandsFromDirectory(commandsDir: string): Record<string, CommandRule> {
  if (!existsSync(commandsDir)) {
    debugLog(`command-discovery: commands directory not found: ${commandsDir}`);
    return {};
  }

  const discovered: Record<string, CommandRule> = Object.create(null);
  let entries: string[] = [];
  const resolvedCommandsDir = resolve(commandsDir);
  let realCommandsDir = resolvedCommandsDir;

  try {
    realCommandsDir = realpathSync(resolvedCommandsDir);
  } catch (error) {
    debugLog(
      `command-discovery: failed to resolve real path for commands dir ${commandsDir}: ${String(error)}`
    );
    return {};
  }

  try {
    entries = readdirSync(commandsDir);
  } catch (error) {
    debugLog(`command-discovery: failed to read commands dir ${commandsDir}: ${String(error)}`);
    return {};
  }

  for (const entry of entries) {
    const fullPath = join(commandsDir, entry);
    try {
      const lstats = lstatSync(fullPath);
      if (lstats.isSymbolicLink()) {
        debugLog(`command-discovery: skipping symlinked command file: ${fullPath}`);
        continue;
      }
      const realFilePath = realpathSync(fullPath);
      const relativePath = relative(realCommandsDir, realFilePath);
      if (relativePath.startsWith('..') || relativePath.includes(':')) {
        debugLog(`command-discovery: skipping command outside directory: ${fullPath}`);
        continue;
      }

      const stats = statSync(realFilePath);
      if (!stats.isFile() || extname(entry).toLowerCase() !== '.md') {
        continue;
      }

      const commandName = basename(entry, '.md');
      if (!isValidCommandName(commandName)) {
        debugLog(`command-discovery: skipping invalid command name from markdown: ${commandName}`);
        continue;
      }
      const markdown = readFileSync(realFilePath, 'utf-8');
      discovered[commandName] = buildCommandRuleFromMarkdown(commandName, markdown, realFilePath);
    } catch (error) {
      debugLog(`command-discovery: failed to parse command file ${fullPath}: ${String(error)}`);
      continue;
    }
  }

  return discovered;
}

function discoverCommandsFromConfig(configPath: string): Record<string, CommandRule> {
  if (!existsSync(configPath)) {
    debugLog(`command-discovery: config not found: ${configPath}`);
    return {};
  }

  try {
    const configText = readFileSync(configPath, 'utf-8');
    const raw = parseJsoncLike(configText) as {
      command?: Record<string, Record<string, unknown>>;
    };

    const commands = raw.command || {};
    const discovered: Record<string, CommandRule> = Object.create(null);

    for (const [commandName, config] of Object.entries(commands)) {
      if (!isValidCommandName(commandName)) {
        debugLog(`command-discovery: skipping invalid config command name: ${commandName}`);
        continue;
      }
      const template = config.template;
      if (typeof template !== 'string' || template.trim().length === 0) {
        debugLog(`command-discovery: skipping config command without template: ${commandName}`);
        continue;
      }

      const promptTriggerKeywords = parsePromptTriggerKeywords(config);
      const description =
        typeof config.description === 'string'
          ? config.description
          : `Command ${commandName}`;
      const workflowPhase = getWorkflowPhaseForCommand(commandName);
      const summary = buildCommandSummary({
        explicitSummary: typeof config.summary === 'string' ? config.summary : undefined,
        template,
      });
      discovered[commandName] = {
        type: parseCommandType(config.type),
        description,
        summary,
        workflowPhase,
        template,
        autoInject: typeof config.autoInject === 'boolean' ? config.autoInject : undefined,
        requiredCommands: parseStringList(config.requiredCommands),
        injectionOrder: parseNumber(config.injectionOrder),
        promptTriggers: promptTriggerKeywords ? { keywords: promptTriggerKeywords } : undefined,
        agent: typeof config.agent === 'string' ? config.agent : undefined,
        subtask: typeof config.subtask === 'boolean' ? config.subtask : undefined,
        model: typeof config.model === 'string' ? config.model : undefined,
        source: 'config',
        sourcePath: configPath,
      };
    }

    return discovered;
  } catch (error) {
    debugLog(`command-discovery: failed to parse config ${configPath}: ${String(error)}`);
    return {};
  }
}

export function discoverCommands(options: CommandDiscoveryOptions): Record<string, CommandRule> {
  const commandsDirs = options.commandsDirs || [];
  const configPath = options.configPath;
  const fromMarkdown = commandsDirs.reduce<Record<string, CommandRule>>((acc, dir) => {
    return { ...acc, ...discoverCommandsFromDirectory(dir) };
  }, Object.create(null) as Record<string, CommandRule>);

  if (!configPath) {
    return fromMarkdown;
  }

  const fromConfig = discoverCommandsFromConfig(configPath);
  return {
    ...fromMarkdown,
    ...fromConfig,
  };
}

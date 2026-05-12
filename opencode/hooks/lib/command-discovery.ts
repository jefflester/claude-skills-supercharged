/**
 * Command discovery from OpenCode config and markdown command directories.
 */

import { existsSync, readdirSync, readFileSync, statSync, lstatSync, realpathSync } from 'fs';
import { extname, join, basename, resolve, relative } from 'path';
import { debugLog } from './debug-logger.js';
import type { CommandRule } from './types.js';

interface CommandDiscoveryOptions {
  configPath?: string;
  commandsDirs?: string[];
}

const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const RESERVED_COMMAND_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

export function buildCommandRuleFromMarkdown(
  commandName: string,
  markdown: string,
  sourcePath: string
): CommandRule {
  const { frontmatter, body } = parseFrontmatter(markdown);
  return {
    description:
      typeof frontmatter.description === 'string'
        ? frontmatter.description
        : `Command ${commandName}`,
    template: body,
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

      discovered[commandName] = {
        description:
          typeof config.description === 'string'
            ? config.description
            : `Command ${commandName}`,
        template,
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

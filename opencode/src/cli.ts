#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { access } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { debugLog } from '../hooks/lib/debug-logger.js';
import { buildSkillRulesFromSkills, SKILL_RULES_PATH, SKILLS_DIR } from '../hooks/lib/skill-discovery.js';
import { discoverCommands, resolveCommandDiscoveryOptions } from '../hooks/lib/command-discovery.js';
import { filterCommandReferences } from '../hooks/lib/command-filtration.js';
import { MAX_REQUIRED_COMMANDS, MAX_SUGGESTED_COMMANDS } from '../hooks/lib/constants.js';
import type {
  AnalysisResult,
  CommandRule,
  SkillRule,
  SkillRulesConfig,
} from '../hooks/lib/types.js';

type CliFormat = 'text' | 'json';

type SelectionLabel = 'critical' | 'promoted' | 'affinity' | 'dependency' | 'suggested';

interface CliOptions {
  sessionId?: string;
  threshold?: number;
  provider?: string;
  debug: boolean;
  format: CliFormat;
}

interface CliParseResult {
  prompt: string;
  options: CliOptions;
}

interface SkillSelectionResult {
  prompt: string;
  selected: string[];
  suggested: string[];
  affinity: string[];
  scores: Record<string, number>;
  labels: Record<string, SelectionLabel>;
  promoted: string[];
  commands: string[];
  suggestedCommands: string[];
  alreadyLoadedCommands: string[];
  commandScores: Record<string, number>;
  sessionId?: string;
  threshold: number;
  provider?: string;
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

let runtimeModulesPromise: Promise<RuntimeModules> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseNumberOption(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function normalizeFormat(value: string | undefined): CliFormat {
  return value === 'json' ? 'json' : 'text';
}

function getProjectDirectory(): string {
  return process.env.OPENCODE_PROJECT_DIR || process.cwd();
}

function getPluginDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function parseCliArgs(argv: string[]): CliParseResult {
  const parsedArgs = parseArgs({
    args: argv,
    options: {
      sessionId: { type: 'string' },
      threshold: { type: 'string' },
      provider: { type: 'string' },
      debug: { type: 'boolean' },
      format: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });

  const promptText = parsedArgs.positionals.join(' ').trim();
  if (!promptText) {
    throw new Error('Missing prompt. Usage: select-skills [options] "prompt text"');
  }

  const threshold = parseNumberOption(parsedArgs.values.threshold, parseNumberOption(process.env.SKILL_CONFIDENCE_THRESHOLD, 0.65));
  const provider = typeof parsedArgs.values.provider === 'string' ? parsedArgs.values.provider.trim() : '';

  return {
    prompt: promptText,
    options: {
      sessionId: typeof parsedArgs.values.sessionId === 'string' && parsedArgs.values.sessionId.trim().length > 0
        ? parsedArgs.values.sessionId.trim()
        : undefined,
      threshold,
      provider: provider.length > 0 ? provider : undefined,
      debug: parsedArgs.values.debug === true,
      format: normalizeFormat(typeof parsedArgs.values.format === 'string' ? parsedArgs.values.format : undefined),
    },
  };
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

function prepareRuntimeEnvironment(provider?: string): void {
  if (process.env.OPENCODE_SKILLS_DEBUG === undefined) {
    process.env.OPENCODE_SKILLS_DEBUG = '0';
  }

  if (provider && provider.length > 0) {
    process.env.OPENCODE_SKILLS_PROVIDER = provider;
  }
}

async function loadRuntimeModules(): Promise<RuntimeModules> {
  if (runtimeModulesPromise) {
    return runtimeModulesPromise;
  }

  runtimeModulesPromise = (async () => {
    const [
      intentAnalyzerModule,
      skillResolutionModule,
      skillFiltrationModule,
      skillStateManagerModule,
      loggerModule,
    ] = await Promise.all([
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
      readAcknowledgedState: skillStateManagerModule.readAcknowledgedState,
      writeSessionState: skillStateManagerModule.writeSessionState,
      debugLog: loggerModule.debugLog,
    };
  })();

  return runtimeModulesPromise;
}

async function resolveStateDirectory(pluginDirectory: string, projectDirectory: string): Promise<string> {
  const legacyStateDirectory = join(projectDirectory, '.claude', 'hooks', 'state');
  try {
    await access(legacyStateDirectory);
    return legacyStateDirectory;
  } catch {
    return join(pluginDirectory, 'state');
  }
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

function parseCommandThreshold(): number {
  return parseNumberOption(process.env.COMMAND_CONFIDENCE_THRESHOLD, 0.9);
}

function parseCommandSuggestedThreshold(requiredThreshold: number): number {
  return Math.min(
    parseNumberOption(process.env.COMMAND_SUGGESTED_THRESHOLD, 0.7),
    requiredThreshold
  );
}

function uniqueSortedCommandNames(
  commandNames: string[],
  scoreMap: Record<string, number>
): string[] {
  return Array.from(new Set(commandNames))
    .map((commandName, index) => ({
      commandName,
      index,
      score: scoreMap[commandName],
    }))
    .sort((left, right) => {
      const leftHasScore = typeof left.score === 'number';
      const rightHasScore = typeof right.score === 'number';
      if (leftHasScore && rightHasScore && left.score !== right.score) {
        return right.score - left.score;
      }
      if (leftHasScore !== rightHasScore) {
        return leftHasScore ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.commandName);
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

export function buildCommandConfidenceBuckets(
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
    required: uniqueSortedCommandNames(requiredCommands, scoreMap).slice(0, MAX_REQUIRED_COMMANDS),
    suggested: uniqueSortedCommandNames(suggestedCommands, scoreMap).slice(0, MAX_SUGGESTED_COMMANDS),
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

export async function selectSkills(
  prompt: string,
  options: CliOptions = { debug: false, format: 'text' }
): Promise<SkillSelectionResult> {
  if (options.debug === true) {
    process.env.OPENCODE_SKILLS_DEBUG = '1';
  } else if (process.env.OPENCODE_SKILLS_DEBUG === undefined) {
    process.env.OPENCODE_SKILLS_DEBUG = '0';
  }
  prepareRuntimeEnvironment(options.provider);

  const projectDirectory = getProjectDirectory();
  const pluginDirectory = getPluginDirectory();
  const stateDirectory = await resolveStateDirectory(pluginDirectory, projectDirectory);
  const rules = await loadSkillRules();
  const commandRules = discoverCommands(resolveCommandDiscoveryOptions(projectDirectory));
  const modules = await loadRuntimeModules();
  const quietMode = options.debug !== true;
  const acknowledgedState = options.sessionId
    ? await withConsoleSuppressed(quietMode, () =>
        Promise.resolve(modules.readAcknowledgedState(stateDirectory, options.sessionId!))
      )
    : { acknowledgedSkills: [], acknowledgedCommands: [] };
  const acknowledgedSkills = acknowledgedState.acknowledgedSkills;
  const acknowledgedCommands = acknowledgedState.acknowledgedCommands;

  const analysis = await withConsoleSuppressed(quietMode, () =>
    modules.analyzeIntent(prompt, rules.skills, commandRules)
  );

  const threshold = parseSelectionThreshold(options.threshold);
  const confidenceBuckets = buildConfidenceBuckets(analysis, threshold);
  const commandConfidenceBuckets = buildCommandConfidenceBuckets(
    analysis,
    parseCommandThreshold()
  );
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
  const selectionScores: Record<string, number> = {};

  for (const skillName of baseSkills) {
    const confidence = confidenceBuckets.scores[skillName];
    if (typeof confidence === 'number') {
      selectionScores[skillName] = confidence;
    }
  }

  for (const skillName of affinitySkills) {
    const confidence = confidenceBuckets.scores[skillName];
    if (typeof confidence === 'number') {
      selectionScores[skillName] = confidence;
    }
  }

  const labels: Record<string, SelectionLabel> = {};
  for (const skillName of baseSkills) {
    labels[skillName] = getSelectionLabel(skillName, requiredSkillSet, promotedSkillSet, affinitySkillSet);
  }
  for (const skillName of affinitySkills) {
    labels[skillName] = 'affinity';
  }

  const selection: SkillSelectionResult = {
    prompt,
    selected: baseSkills,
    suggested: filtration.remainingSuggested,
    affinity: affinitySkills,
    scores: selectionScores,
    labels,
    promoted: filtration.promoted,
    commands: commandFiltration.toInject,
    suggestedCommands: commandFiltration.remainingSuggested,
    alreadyLoadedCommands,
    commandScores: commandConfidenceBuckets.scores,
    sessionId: options.sessionId,
    threshold,
    provider: options.provider,
  };

  if (options.sessionId) {
    const injectedSkills = [...baseSkills, ...affinitySkills];
    const injectedCommands = commandFiltration.toInject;
    modules.writeSessionState(
      stateDirectory,
      options.sessionId,
      [...acknowledgedSkills, ...injectedSkills],
      injectedSkills,
      [...acknowledgedCommands, ...injectedCommands],
      injectedCommands
    );
  }

  return selection;
}

function formatSkillLine(skillName: string, score: number | undefined, label: SelectionLabel): string {
  const scoreText = typeof score === 'number' ? ` (${score.toFixed(2)})` : '';
  return `  → ${skillName}${scoreText} [${label}]`;
}

function formatTextOutput(selection: SkillSelectionResult): string {
  const lines: string[] = [];
  lines.push(`Analyzing intent: "${selection.prompt}"`);
  lines.push('');
  lines.push('Selected skills:');

  if (selection.selected.length === 0) {
    lines.push('  (none)');
  } else {
    for (const skillName of selection.selected) {
      lines.push(formatSkillLine(skillName, selection.scores[skillName], selection.labels[skillName] ?? 'dependency'));
    }
  }

  if (selection.affinity.length > 0) {
    lines.push('');
    lines.push('Affinity skills:');
    for (const skillName of selection.affinity) {
      lines.push(formatSkillLine(skillName, selection.scores[skillName], 'affinity'));
    }
  }

  if (selection.suggested.length > 0) {
    lines.push('');
    lines.push('Suggested skills:');
    for (const skillName of selection.suggested) {
      lines.push(formatSkillLine(skillName, selection.scores[skillName], 'suggested'));
    }
  }

  lines.push('');
  lines.push('Required commands:');
  if (selection.commands.length === 0) {
    lines.push('  (none)');
  } else {
    for (const commandName of selection.commands) {
      const score = selection.commandScores[commandName];
      const scoreText = typeof score === 'number' ? ` (${score.toFixed(2)})` : '';
      lines.push(`  → /${commandName}${scoreText}`);
    }
  }

  lines.push('');
  lines.push('Suggested commands:');
  if (selection.suggestedCommands.length === 0) {
    lines.push('  (none)');
  } else {
    for (const commandName of selection.suggestedCommands) {
      const score = selection.commandScores[commandName];
      const scoreText = typeof score === 'number' ? ` (${score.toFixed(2)})` : '';
      lines.push(`  → /${commandName}${scoreText}`);
    }
  }

  if (selection.alreadyLoadedCommands.length > 0) {
    lines.push('');
    lines.push('Already loaded commands:');
    for (const commandName of selection.alreadyLoadedCommands) {
      lines.push(`  → /${commandName}`);
    }
  }

  const injectedSkills = [...selection.selected, ...selection.affinity];
  lines.push('');
  lines.push(`Injected: ${injectedSkills.join(', ')}`);

  return lines.join('\n');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsedArgs = parseCliArgs(argv);
    const selection = await selectSkills(parsedArgs.prompt, parsedArgs.options);

    if (parsedArgs.options.format === 'json') {
      const payload = {
        prompt: selection.prompt,
        selected: selection.selected,
        suggested: selection.suggested,
        affinity: selection.affinity,
        scores: selection.scores,
        labels: selection.labels,
        promoted: selection.promoted,
        commands: selection.commands,
        suggestedCommands: selection.suggestedCommands,
        alreadyLoadedCommands: selection.alreadyLoadedCommands,
        commandScores: selection.commandScores,
        sessionId: selection.sessionId,
        threshold: selection.threshold,
        provider: selection.provider,
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatTextOutput(selection)}\n`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const modules = await loadRuntimeModules().catch(() => null);
    modules?.debugLog(`CLI failed: ${message}`);
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  void main().then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });
}

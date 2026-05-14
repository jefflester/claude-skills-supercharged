import { readFile } from 'fs/promises';
import { access } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { debugLog } from '../hooks/lib/debug-logger.js';
import { buildSkillRulesFromSkills, SKILL_RULES_PATH, SKILLS_DIR } from '../hooks/lib/skill-discovery.js';
import { MAX_REQUIRED_COMMANDS, MAX_SUGGESTED_COMMANDS } from '../hooks/lib/constants.js';
import type {
  AnalysisResult,
  CommandRule,
  SkillRule,
  SkillRulesConfig,
} from '../hooks/lib/types.js';

export type SelectionLabel = 'critical' | 'promoted' | 'affinity' | 'dependency' | 'suggested';

export interface RuntimeModules {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseNumberOption(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function getProjectDirectory(): string {
  return process.env.OPENCODE_PROJECT_DIR || process.cwd();
}

export function getPluginDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export async function loadSkillRules(): Promise<SkillRulesConfig> {
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

export async function loadRuntimeModules(): Promise<RuntimeModules> {
  if (runtimeModulesPromise) {
    return runtimeModulesPromise;
  }

  runtimeModulesPromise = (async () => {
    const [
      intentAnalyzerModule,
      skillResolutionModule,
      skillFiltrationModule,
      stateModule,
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
      readAcknowledgedState: stateModule.readAcknowledgedState,
      writeSessionState: stateModule.writeSessionState,
      debugLog: loggerModule.debugLog,
    };
  })();

  return runtimeModulesPromise;
}

export async function resolveStateDirectory(pluginDirectory: string, projectDirectory: string): Promise<string> {
  const legacyStateDirectory = join(projectDirectory, '.claude', 'hooks', 'state');
  try {
    await access(legacyStateDirectory);
    return legacyStateDirectory;
  } catch {
    return join(pluginDirectory, 'state');
  }
}

export async function withConsoleSuppressed<T>(quiet: boolean, task: () => Promise<T>): Promise<T> {
  if (quiet) {
    const originalError = console.error; // eslint-disable-line no-console
    const originalWarn = console.warn; // eslint-disable-line no-console
    console.error = ((..._args: unknown[]) => undefined) as typeof console.error; // eslint-disable-line no-console
    console.warn = ((..._args: unknown[]) => undefined) as typeof console.warn; // eslint-disable-line no-console

    try {
      return await task();
    } finally {
      console.error = originalError; // eslint-disable-line no-console
      console.warn = originalWarn; // eslint-disable-line no-console
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

export function parseSuggestedThreshold(): number {
  return parseNumberOption(process.env.SKILL_SUGGESTED_THRESHOLD, 0.5);
}

export function parseCommandThreshold(): number {
  return parseNumberOption(process.env.COMMAND_CONFIDENCE_THRESHOLD, 0.9);
}

export function parseCommandSuggestedThreshold(requiredThreshold: number): number {
  return Math.min(
    parseNumberOption(process.env.COMMAND_SUGGESTED_THRESHOLD, 0.7),
    requiredThreshold
  );
}

export function uniqueSortedCommandNames(
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

export function buildConfidenceBuckets(
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

export function getSelectionLabel(
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

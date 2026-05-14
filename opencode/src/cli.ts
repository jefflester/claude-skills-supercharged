#!/usr/bin/env node

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { discoverCommands, resolveCommandDiscoveryOptions } from '../hooks/lib/command-discovery.js';
import { filterCommandReferences } from '../hooks/lib/command-filtration.js';
import type {
  SelectionLabel,
} from './selection-core.js';
import {
  buildCommandConfidenceBuckets,
  buildConfidenceBuckets,
  getPluginDirectory,
  getProjectDirectory,
  getSelectionLabel,
  loadRuntimeModules,
  loadSkillRules,
  parseCommandThreshold,
  parseNumberOption,
  parseSelectionThreshold,
  resolveStateDirectory,
  withConsoleSuppressed,
} from './selection-core.js';

export { buildCommandConfidenceBuckets, parseNumberOption, parseSelectionThreshold } from './selection-core.js';

type CliFormat = 'text' | 'json';

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

function normalizeFormat(value: string | undefined): CliFormat {
  return value === 'json' ? 'json' : 'text';
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

function prepareRuntimeEnvironment(provider?: string): void {
  if (process.env.OPENCODE_SKILLS_DEBUG === undefined) {
    process.env.OPENCODE_SKILLS_DEBUG = '0';
  }

  if (provider && provider.length > 0) {
    process.env.OPENCODE_SKILLS_PROVIDER = provider;
  }
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

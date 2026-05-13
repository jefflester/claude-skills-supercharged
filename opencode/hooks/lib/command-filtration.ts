/**
 * Command filtering utilities.
 *
 * Commands mirror skill reference filtering: acknowledged filtering,
 * guardrail/domain cap behavior, suggested promotion, and dependency resolution.
 */

import { MAX_REQUIRED_COMMANDS } from './constants.js';
import type { CommandRule } from './types.js';

export interface CommandFiltrationResult {
  toInject: string[];
  promoted: string[];
  remainingSuggested: string[];
}

/**
 * Filter out commands already acknowledged in session state.
 */
export function filterUnacknowledgedCommands(
  commands: string[],
  acknowledged: string[]
): string[] {
  return commands.filter((command) => !acknowledged.includes(command));
}

/**
 * Resolve required command dependencies recursively with cycle detection.
 */
export function resolveCommandDependencies(
  commands: string[],
  commandRules: Record<string, CommandRule>
): string[] {
  const resolved = new Set<string>();
  const visiting = new Set<string>();
  const errors: string[] = [];

  function visit(commandName: string, path: string[] = []): void {
    if (visiting.has(commandName)) {
      errors.push(`Circular command dependency: ${[...path, commandName].join(' -> ')}`);
      return;
    }

    if (resolved.has(commandName)) return;

    const command = commandRules[commandName];
    if (!command) {
      errors.push(`Command not found: ${commandName}`);
      return;
    }

    visiting.add(commandName);
    path.push(commandName);

    for (const dependency of command.requiredCommands || []) {
      visit(dependency, [...path]);
    }

    resolved.add(commandName);
    visiting.delete(commandName);
  }

  for (const commandName of commands) {
    visit(commandName);
  }

  if (errors.length > 0) {
    console.error('Command dependency resolution errors:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
  }

  return Array.from(resolved).sort((a, b) => {
    const orderA = commandRules[a]?.injectionOrder || 50;
    const orderB = commandRules[b]?.injectionOrder || 50;
    return orderA - orderB;
  });
}

/**
 * Apply command injection limits with skill-like promotion behavior.
 */
export function applyCommandReferenceLimits(
  requiredCommands: string[],
  suggestedCommands: string[],
  acknowledgedRequiredCount: number,
  commandRules: Record<string, CommandRule>
): CommandFiltrationResult {
  const targetSlots = MAX_REQUIRED_COMMANDS;
  const requiredGuardrails = requiredCommands.filter(
    (command) => commandRules[command]?.type === 'guardrail'
  );
  const requiredDomain = requiredCommands.filter(
    (command) => commandRules[command]?.type !== 'guardrail'
  );
  const suggestedGuardrails = suggestedCommands.filter(
    (command) => commandRules[command]?.type === 'guardrail'
  );
  const suggestedDomain = suggestedCommands.filter(
    (command) => commandRules[command]?.type !== 'guardrail'
  );

  const promotionTarget = Math.max(0, targetSlots - acknowledgedRequiredCount);
  const domainToInject = [...requiredDomain.slice(0, promotionTarget)];
  const needed = Math.max(0, promotionTarget - domainToInject.length);
  const promoted: string[] = [];

  if (needed > 0 && suggestedDomain.length > 0) {
    const promotedCommands = suggestedDomain.slice(0, needed);
    promoted.push(...promotedCommands);
    domainToInject.push(...promotedCommands);
  }

  const toInject = [...requiredGuardrails, ...suggestedGuardrails, ...domainToInject];
  const remainingSuggested = suggestedDomain.filter(
    (command) => !promoted.includes(command)
  );

  return {
    toInject,
    promoted,
    remainingSuggested,
  };
}

/**
 * Filter required/suggested command references with skill-like promotion.
 */
export function filterCommandReferences(
  requiredCommands: string[],
  suggestedCommands: string[],
  acknowledgedCommands: string[],
  commandRules: Record<string, CommandRule>
): CommandFiltrationResult {
  const unacknowledgedRequired = filterUnacknowledgedCommands(
    requiredCommands,
    acknowledgedCommands
  );
  const unacknowledgedSuggested = filterUnacknowledgedCommands(
    suggestedCommands,
    acknowledgedCommands
  );
  const acknowledgedRequiredCount = requiredCommands.filter(
    (command) => acknowledgedCommands.includes(command) && commandRules[command]?.type !== 'guardrail'
  ).length;
  const filtration = applyCommandReferenceLimits(
    unacknowledgedRequired,
    unacknowledgedSuggested,
    acknowledgedRequiredCount,
    commandRules
  );

  return {
    ...filtration,
    toInject: resolveCommandDependencies(filtration.toInject, commandRules),
  };
}

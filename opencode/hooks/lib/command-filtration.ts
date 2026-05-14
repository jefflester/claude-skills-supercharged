/**
 * Command filtering utilities.
 *
 * Commands mirror skill reference filtering where appropriate: acknowledged
 * filtering, guardrail/domain cap behavior, and dependency resolution.
 */

import { debugLog } from './debug-logger.js';
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
    debugLog(`command-filtration: dependency errors: ${errors.join(', ')}`);
  }

  return Array.from(resolved).sort((a, b) => {
    const orderA = commandRules[a]?.injectionOrder || 50;
    const orderB = commandRules[b]?.injectionOrder || 50;
    return orderA - orderB;
  });
}

/**
 * Apply command injection limits. The required cap is a maximum, not a target:
 * suggested commands remain suggested instead of being promoted to fill slots.
 */
export function applyCommandReferenceLimits(
  requiredCommands: string[],
  suggestedCommands: string[],
  acknowledgedRequiredCount: number,
  commandRules: Record<string, CommandRule>
): CommandFiltrationResult {
  const maxRequiredSlots = MAX_REQUIRED_COMMANDS;
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

  const remainingRequiredSlots = Math.max(0, maxRequiredSlots - acknowledgedRequiredCount);
  const domainToInject = [...requiredDomain.slice(0, remainingRequiredSlots)];

  const toInject = [...requiredGuardrails, ...domainToInject];

  return {
    toInject,
    promoted: [],
    remainingSuggested: [...suggestedGuardrails, ...suggestedDomain],
  };
}

/**
 * Filter required/suggested command references.
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

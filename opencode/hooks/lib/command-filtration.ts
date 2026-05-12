/**
 * Command filtering utilities.
 *
 * Commands are reference-only in this lane: no promotion from suggested to required.
 */

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
 * Filter required/suggested command references without promotion.
 */
export function filterCommandReferences(
  requiredCommands: string[],
  suggestedCommands: string[],
  acknowledgedCommands: string[]
): { toInject: string[]; remainingSuggested: string[] } {
  const toInject = filterUnacknowledgedCommands(requiredCommands, acknowledgedCommands);
  const remainingSuggested = filterUnacknowledgedCommands(
    suggestedCommands,
    acknowledgedCommands
  );

  return { toInject, remainingSuggested };
}

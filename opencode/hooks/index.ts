import { access, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { analyzeIntent } from './lib/intent-analyzer.js';
import { resolveSkillDependencies } from './lib/skill-resolution.js';
import { filterAndPromoteSkills, findAffinityInjections } from './lib/skill-filtration.js';
import { readAcknowledgedSkills, writeSessionState } from './lib/skill-state-manager.js';
import {
  injectSkillContent,
  formatActivationBanner,
  formatJustInjectedSection,
  formatAlreadyLoadedSection,
  formatRecommendedSection,
  formatClosingBanner,
} from './lib/output-formatter.js';
import { debugLog } from './lib/debug-logger.js';
import { buildSkillRulesFromSkills, SKILL_RULES_PATH, SKILLS_DIR } from './lib/skill-discovery.js';
import type { AnalysisResult, SkillRule, SkillRulesConfig } from './lib/types.js';

interface PluginInputLike {
  directory: string;
  client?: {
    session?: {
      messages?: (input: { path: { id: string } }) => Promise<{ data?: unknown }>;
    };
  };
}

interface SessionIdentity {
  id?: string;
  sessionID?: string;
  conversationID?: string;
  conversation_id?: string;
}

interface HookEvent {
  type: string;
  properties?: {
    info?: SessionIdentity;
    sessionID?: string;
  };
}

interface ChatPart {
  type?: string;
  text?: string;
}

interface ChatMessageOutput {
  message: unknown;
  parts: ChatPart[];
}

interface HooksLike {
  event?: (input: { event: HookEvent }) => Promise<void>;
  'chat.message'?: (
    input: {
      sessionID: string;
      agent?: string;
      model?: unknown;
      messageID?: string;
      variant?: string;
    },
    output: ChatMessageOutput
  ) => Promise<void>;
  'experimental.chat.system.transform'?: (
    input: { sessionID: string; model: unknown },
    output: { system: string[] }
  ) => Promise<void>;
}

interface SessionRuntimeState {
  analysis?: AnalysisResult;
  injected: boolean;
}

const sessionRuntimeState = new Map<string, SessionRuntimeState>();

function extractSessionId(source: SessionIdentity | undefined): string | null {
  if (!source) {
    return null;
  }

  if (typeof source.sessionID === 'string' && source.sessionID.length > 0) {
    return source.sessionID;
  }

  if (typeof source.id === 'string' && source.id.length > 0) {
    return source.id;
  }

  if (typeof source.conversationID === 'string' && source.conversationID.length > 0) {
    return source.conversationID;
  }

  if (typeof source.conversation_id === 'string' && source.conversation_id.length > 0) {
    return source.conversation_id;
  }

  return null;
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveStateDirectory(pluginDirectory: string, projectDirectory: string): Promise<string> {
  const legacyStateDirectory = join(projectDirectory, '.claude', 'hooks', 'state');
  if (await directoryExists(legacyStateDirectory)) {
    return legacyStateDirectory;
  }

  return join(pluginDirectory, 'state');
}

async function loadSkillRules(): Promise<SkillRulesConfig> {
  try {
    const rawRules = await readFile(SKILL_RULES_PATH, 'utf8');
    const parsedRules = JSON.parse(rawRules) as {
      version?: unknown;
      skills?: Record<string, SkillRule>;
    };

    if (
      typeof parsedRules.version !== 'string' ||
      parsedRules.skills === undefined ||
      parsedRules.skills === null ||
      typeof parsedRules.skills !== 'object' ||
      Array.isArray(parsedRules.skills)
    ) {
      debugLog(`Invalid skill-rules.json at ${SKILL_RULES_PATH}. Falling back to skill discovery.`);
      return buildSkillRulesFromSkills(SKILLS_DIR);
    }

    return {
      version: parsedRules.version,
      skills: parsedRules.skills,
    };
  } catch (error) {
    debugLog(`Failed to load ${SKILL_RULES_PATH}: ${String(error)}. Falling back to skill discovery from ${SKILLS_DIR}.`);
    return buildSkillRulesFromSkills(SKILLS_DIR);
  }
}

async function removeSessionStateFile(stateDirectory: string, sessionID: string): Promise<void> {
  const sessionStatePath = join(stateDirectory, `${sessionID}-skills-suggested.json`);

  try {
    await unlink(sessionStatePath);
  } catch (error) {
    debugLog(`Failed to remove session state ${sessionStatePath}: ${String(error)}`);
  }
}

function extractTextFromMessagePart(part: unknown): string | null {
  if (typeof part !== 'object' || part === null || !('type' in part) || !('text' in part)) {
    return null;
  }

  const candidate = part as { type?: unknown; text?: unknown };
  if (candidate.type === 'text' && typeof candidate.text === 'string') {
    return candidate.text;
  }

  return null;
}

function extractUserPromptFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return '';
  }

  const userParts: string[] = [];
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) {
      continue;
    }

    const candidate = message as {
      role?: unknown;
      parts?: unknown;
      info?: {
        role?: unknown;
        parts?: unknown;
      };
    };
    const role = candidate.info?.role ?? candidate.role;
    if (role !== 'user') {
      continue;
    }

    const parts = candidate.parts ?? candidate.info?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      const text = extractTextFromMessagePart(part);
      if (text) {
        userParts.push(text);
      }
    }
  }

  return userParts.join('\n').trim();
}

export default async function plugin(input: PluginInputLike): Promise<HooksLike> {
  const projectDirectory = process.env.OPENCODE_PROJECT_DIR || process.cwd();
  const stateDirectory = await resolveStateDirectory(input.directory, projectDirectory);
  const skillRules = await loadSkillRules();
  const availableSkillNames = new Set(Object.keys(skillRules.skills));

  async function fetchUserPrompt(sessionID: string): Promise<string> {
    try {
      const response = await input.client?.session?.messages?.({ path: { id: sessionID } });
      return extractUserPromptFromMessages(response?.data);
    } catch (error) {
      debugLog(`Failed to fetch session messages for ${sessionID}: ${String(error)}`);
      return '';
    }
  }

  return {
    event: async ({ event }) => {
      try {
        switch (event.type) {
          case 'session.created': {
            const sessionID = extractSessionId(event.properties?.info);
            if (!sessionID) {
              return;
            }

            sessionRuntimeState.set(sessionID, { injected: false });
            writeSessionState(stateDirectory, sessionID, [], []);
            return;
          }

          case 'session.deleted': {
            const sessionID = extractSessionId(event.properties?.info);
            if (!sessionID) {
              return;
            }

            sessionRuntimeState.delete(sessionID);
            await removeSessionStateFile(stateDirectory, sessionID);
            return;
          }

          case 'session.compacted': {
            const sessionID = event.properties?.sessionID;
            if (!sessionID) {
              return;
            }

            sessionRuntimeState.delete(sessionID);
            writeSessionState(stateDirectory, sessionID, [], []);
            return;
          }

          default:
            return;
        }
      } catch (error) {
        debugLog(`event hook failed: ${String(error)}`);
      }
    },
    'chat.message': async ({ sessionID }, output) => {
      try {
        debugLog(`chat.message observed session=${sessionID} parts=${output.parts.length}`);
      } catch (error) {
        debugLog(`chat.message hook failed: ${String(error)}`);
      }
    },
    'experimental.chat.system.transform': async ({ sessionID }, output) => {
      try {
        let runtimeState = sessionRuntimeState.get(sessionID);
        if (runtimeState?.injected) {
          return;
        }

        if (!runtimeState?.analysis) {
          const userPrompt = await fetchUserPrompt(sessionID);
          if (!userPrompt) {
            debugLog(`system.transform skipped session=${sessionID}: no user prompt available`);
            return;
          }

          const analysis = await analyzeIntent(userPrompt, skillRules.skills);
          runtimeState = {
            analysis,
            injected: false,
          };
          sessionRuntimeState.set(sessionID, runtimeState);
          debugLog(
            `system.transform analyzed session=${sessionID} promptChars=${userPrompt.length} required=${analysis.required.join(',')} suggested=${analysis.suggested.join(',')}`
          );
        }

        const acknowledgedSkills = readAcknowledgedSkills(stateDirectory, sessionID);
        const analysis = runtimeState.analysis;
        if (!analysis) {
          debugLog(`system.transform skipped session=${sessionID}: analysis unavailable`);
          return;
        }

        const requiredSkills = analysis.required.filter((skillName) =>
          availableSkillNames.has(skillName)
        );
        const suggestedSkills = analysis.suggested.filter((skillName) =>
          availableSkillNames.has(skillName)
        );

        const filtration = filterAndPromoteSkills(
          requiredSkills,
          suggestedSkills,
          acknowledgedSkills,
          skillRules.skills
        );

        const affinitySkills = findAffinityInjections(
          filtration.toInject,
          acknowledgedSkills,
          skillRules.skills
        );

        const resolvedSkills = resolveSkillDependencies(
          [...filtration.toInject, ...affinitySkills],
          skillRules.skills
        );

        const injectedSkills = Array.from(
          new Set(resolvedSkills.filter((skillName) => !acknowledgedSkills.includes(skillName)))
        );

        const summaryParts: string[] = [];
        const shouldShowSummary =
          injectedSkills.length > 0 || acknowledgedSkills.length > 0 || filtration.remainingSuggested.length > 0;

        debugLog(
          `system.transform selected session=${sessionID} inject=${injectedSkills.join(',')} recommended=${filtration.remainingSuggested.join(',')} acknowledged=${acknowledgedSkills.join(',')}`
        );

        if (shouldShowSummary) {
          summaryParts.push(formatActivationBanner());

          if (injectedSkills.length > 0) {
            summaryParts.push(
              formatJustInjectedSection(
                injectedSkills,
                filtration.toInject,
                affinitySkills,
                filtration.promoted
              )
            );
          } else if (acknowledgedSkills.length > 0) {
            summaryParts.push(formatAlreadyLoadedSection(acknowledgedSkills));
          }

          summaryParts.push(formatRecommendedSection(filtration.remainingSuggested, analysis.scores));
          summaryParts.push(formatClosingBanner());

          output.system.push(summaryParts.join(''));
        }

        if (injectedSkills.length > 0) {
          const xmlContent = injectSkillContent(injectedSkills);
          if (xmlContent.length > 0) {
            output.system.push(xmlContent);

            const updatedAcknowledgedSkills = Array.from(
              new Set([...acknowledgedSkills, ...injectedSkills])
            );
            writeSessionState(stateDirectory, sessionID, updatedAcknowledgedSkills, injectedSkills);
          }
        } else {
          writeSessionState(stateDirectory, sessionID, acknowledgedSkills, []);
        }

        sessionRuntimeState.set(sessionID, {
          analysis: runtimeState.analysis,
          injected: true,
        });
      } catch (error) {
        debugLog(`system.transform hook failed: ${String(error)}`);
      }
    },
  };
}

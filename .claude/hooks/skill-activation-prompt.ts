#!/usr/bin/env node
/**
 * Skill Activation Hook - Main Entry Point
 *
 * Orchestrates skill auto-loading using modular components.
 * Analyzes user prompts via AI, filters/promotes skills, and injects
 * skill content into the conversation context.
 */

import { readFileSync } from 'fs';
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
import type { SkillRulesConfig } from './lib/types.js';
import { debugLog } from './lib/debug-logger.js';

/**
 * Hook input from Claude
 */
interface HookInput {
  session_id: string;
  conversation_id?: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  prompt: string;
}

/**
 * Main hook execution
 */
async function main(): Promise<void> {
  try {
    // Read input from stdin
    const input = readFileSync(0, 'utf-8');
    const data: HookInput = JSON.parse(input);

    // Load skill rules
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const rulesPath = join(projectDir, '.claude', 'skills', 'skill-rules.json');
    const rules: SkillRulesConfig = JSON.parse(readFileSync(rulesPath, 'utf-8'));

    // Analyze user intent with AI
    const analysis = await analyzeIntent(data.prompt, rules.skills);
    // Filter out non-existent skills (AI could return invalid names)
    const requiredDomainSkills = (analysis.required || []).filter((name) => name in rules.skills);
    const suggestedDomainSkills = (analysis.suggested || []).filter((name) => name in rules.skills);

    // DEBUG: Log AI analysis results
    debugLog('=== NEW PROMPT ===');
    debugLog(`Prompt: ${data.prompt}`);
    debugLog('AI Analysis Results:');
    debugLog(`  Required (critical): ${JSON.stringify(requiredDomainSkills)}`);
    debugLog(`  Suggested: ${JSON.stringify(suggestedDomainSkills)}`);
    debugLog(`  Scores: ${JSON.stringify(analysis.scores || {})}`);

    // Output banner
    let output = formatActivationBanner();

    // Handle skill injection for domain skills only
    const hasMatchedSkills = requiredDomainSkills.length > 0 || suggestedDomainSkills.length > 0;
    if (hasMatchedSkills) {
      // State management
      const stateDir = join(projectDir, '.claude', 'hooks', 'state');
      const stateId = data.conversation_id || data.session_id;
      const existingAcknowledged = readAcknowledgedSkills(stateDir, stateId);

      // DEBUG: Log session state
      debugLog('Session State:');
      debugLog(`  Already acknowledged: ${JSON.stringify(existingAcknowledged)}`);

      // Filter and promote skills
      const filtration = filterAndPromoteSkills(
        requiredDomainSkills,
        suggestedDomainSkills,
        existingAcknowledged,
        rules.skills
      );

      // DEBUG: Log filtration results
      debugLog('Filtration Results:');
      debugLog(`  To inject: ${JSON.stringify(filtration.toInject)}`);
      debugLog(`  Promoted: ${JSON.stringify(filtration.promoted)}`);
      debugLog(`  Remaining suggested: ${JSON.stringify(filtration.remainingSuggested)}`);

      // Find affinity injections (bidirectional, free of slot cost)
      const affinitySkills = findAffinityInjections(
        filtration.toInject,
        existingAcknowledged,
        rules.skills
      );

      // DEBUG: Log affinity results
      debugLog('Affinity Injection:');
      debugLog(`  Affinity skills found: ${JSON.stringify(affinitySkills)}`);

      // Resolve dependencies and inject skills
      let injectedSkills: string[] = [];
      const allSkillsToInject = [...filtration.toInject, ...affinitySkills];

      // DEBUG: Log combined skills before dependency resolution
      debugLog('Combined Skills (before dependency resolution):');
      debugLog(`  All skills to inject: ${JSON.stringify(allSkillsToInject)}`);

      if (allSkillsToInject.length > 0) {
        injectedSkills = resolveSkillDependencies(allSkillsToInject, rules.skills);

        // DEBUG: Log final injected skills
        debugLog('Final Injection:');
        debugLog(`  After dependency resolution: ${JSON.stringify(injectedSkills)}`);

        // Inject skills individually (one console.log per skill)
        for (const skillName of injectedSkills) {
          const skillPath = join(projectDir, '.claude', 'skills', skillName, 'SKILL.md');
          debugLog(`  Injecting skill: ${skillName} from ${skillPath}`);

          const injectionOutput = injectSkillContent([skillName], projectDir);
          if (injectionOutput) {
            console.log(injectionOutput);
            debugLog(`  ✓ Injected ${skillName} (${injectionOutput.length} chars)`);
          } else {
            debugLog(`  ✗ Failed to inject ${skillName} - no output generated`);
          }
        }
      }

      // Show just-injected skills in banner
      if (injectedSkills.length > 0) {
        output += formatJustInjectedSection(
          injectedSkills,
          filtration.toInject,
          affinitySkills,
          filtration.promoted
        );
      }

      // Show already-loaded skills
      const alreadyAcknowledged = [...requiredDomainSkills, ...suggestedDomainSkills].filter(
        (skill) => existingAcknowledged.includes(skill)
      );
      if (alreadyAcknowledged.length > 0 && injectedSkills.length === 0) {
        output += formatAlreadyLoadedSection(alreadyAcknowledged);
      }

      // Show remaining recommended skills
      output += formatRecommendedSection(filtration.remainingSuggested, analysis.scores);

      output += formatClosingBanner();
      console.log(output);

      // Write session state
      if (injectedSkills.length > 0) {
        writeSessionState(
          stateDir,
          stateId,
          [...existingAcknowledged, ...injectedSkills],
          injectedSkills
        );
      }
    }
  } catch (err) {
    console.error('⚠️ Skill activation hook error:', err);
    process.exit(0); // Don't fail the conversation on hook errors
  }
}

main();

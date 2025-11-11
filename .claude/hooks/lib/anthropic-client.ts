/**
 * Anthropic API client for intent analysis
 *
 * Handles communication with Claude API for AI-powered skill intent analysis.
 * Includes prompt template loading, API calls, and response parsing.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { IntentAnalysis, SkillRule } from './types.js';

// Load intent analysis prompt template
const INTENT_PROMPT_TEMPLATE = readFileSync(
  join(
    process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    '.claude',
    'hooks',
    'config',
    'intent-analysis-prompt.txt'
  ),
  'utf-8'
);

/**
 * Call Anthropic API for AI-powered intent analysis
 *
 * Uses Claude to analyze user prompts and determine skill relevance.
 * Model is configurable via CLAUDE_SKILLS_MODEL env var (defaults to claude-haiku-4-5).
 * Applies template substitutions and parses JSON response.
 *
 * @param prompt - The user's input prompt to analyze
 * @param skills - Available skills configuration from skill-rules.json
 * @returns Parsed intent analysis with skill confidence scores
 * @throws Error if ANTHROPIC_API_KEY is not configured or API call fails
 *
 * @example
 * ```typescript
 * const analysis = await callAnthropicAPI("Fix the authentication service", skillRules);
 * // Returns: { primary_intent: "...", skills: [{ name: "service-layer-development", confidence: 0.90, ...}] }
 * ```
 */
export async function callAnthropicAPI(
  prompt: string,
  skills: Record<string, SkillRule>
): Promise<IntentAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
        '❌ ANTHROPIC_API_KEY not found\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
        'AI-powered skill intent analysis requires an Anthropic API key.\n\n' +
        'Setup instructions:\n' +
        '1. Go to https://console.anthropic.com/\n' +
        '2. Navigate to API Keys section\n' +
        '3. Create a new API key\n' +
        '4. Create .claude/hooks/.env file:\n' +
        '   cp .claude/hooks/.env.example .claude/hooks/.env\n' +
        '5. Add your key:\n' +
        '   ANTHROPIC_API_KEY=sk-ant-your-key-here\n\n' +
        'Cost: ~$0.0003 per analysis (~$1/month at 100 prompts/day)\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
    );
  }

  const client = new Anthropic({ apiKey });

  // Build skill descriptions for prompt
  const skillDescriptions = Object.entries(skills)
    .map(([name, config]) => `- ${name}: ${config.description || 'No description'}`)
    .join('\n');

  // Apply template substitutions
  const analysisPrompt = INTENT_PROMPT_TEMPLATE.replace('{{USER_PROMPT}}', prompt).replace(
    '{{SKILL_DESCRIPTIONS}}',
    skillDescriptions
  );

  // Call Claude API (model configurable via CLAUDE_SKILLS_MODEL env var)
  const model = process.env.CLAUDE_SKILLS_MODEL || 'claude-haiku-4-5';
  const response = await client.messages.create({
    model,
    max_tokens: 500,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: analysisPrompt,
      },
    ],
  });

  // Extract text content
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic API');
  }

  // Parse JSON response (with markdown fence handling)
  return parseApiResponse(content.text);
}

/**
 * Parse Anthropic API response text to IntentAnalysis
 *
 * Handles JSON responses that may be wrapped in markdown code fences.
 * Extracts JSON object even if surrounded by extra text.
 *
 * @param responseText - Raw text response from API
 * @returns Parsed intent analysis
 * @throws Error if JSON parsing fails
 */
function parseApiResponse(responseText: string): IntentAnalysis {
  let jsonText = responseText.trim();

  // Strip markdown code fences if present (```json ... ```)
  if (jsonText.startsWith('```')) {
    // Remove opening fence (```json or ```JSON or just ```)
    jsonText = jsonText.replace(/^```(?:json|JSON)?\s*\n/, '');
    // Remove closing fence and anything after it
    jsonText = jsonText.replace(/\n```.*$/s, '');
  }

  // Find the JSON object boundaries (handles extra text before/after)
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonText = jsonMatch[0];
  }

  return JSON.parse(jsonText);
}

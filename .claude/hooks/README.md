# Claude Code Skills System - Hooks

This directory contains the hook implementation that enables AI-powered skill auto-activation for Claude Code.

## What Are Hooks?

Hooks are scripts that execute at specific points in Claude Code's workflow:

- **UserPromptSubmit** - Before Claude sees your prompt
- **PostToolUse** - After Edit/Write/MultiEdit tools complete
- **Stop** - When you stop Claude's response

## The Skill Activation System

### skill-activation-prompt (UserPromptSubmit Hook)

**Purpose:** Automatically inject relevant skills into Claude's context based on your prompt using AI-powered intent analysis.

**How it works:**

1. Reads your prompt and conversation history
1. Uses Claude (configurable model, defaults to Haiku 4.5) to analyze PRIMARY task intent
1. Assigns confidence scores (0.0-1.0) to each skill
1. Automatically injects high-confidence skills (>0.65) into context
1. Suggests medium-confidence skills (0.50-0.65) as optional
1. Falls back to keyword matching if AI analysis fails
1. Caches analysis results for 1 hour to improve performance

**Example:**

```
User: "I need to add a new REST API endpoint"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 AUTO-LOADED SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<skill name="api-security">
[Skill content automatically injected...]
</skill>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Key Features:**

- **AI-Powered Intent Analysis**: Claude analyzes prompts for accurate skill detection (model configurable via env var)
- **Smart Caching**: 1-hour TTL reduces API costs and improves response time
- **Bidirectional Affinity**: Related skills automatically loaded together
- **Session Tracking**: Skills only injected once per conversation
- **Progressive Disclosure**: Resources separated to maintain 500-line limit
- **Fallback to Keywords**: Keyword matching if AI analysis fails

**Setup:**

1. Install dependencies:

   ```bash
   cd .claude/hooks
   npm install
   ```

2. Create `.env` file with your Anthropic API key:

   ```bash
   cp .env.example .env
   # Edit .env and add: ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

3. Get API key from https://console.anthropic.com/

**Performance:**

- AI analysis: ~200ms (first call), <10ms (cached)
- Cost: ~$1-2/month at 100 prompts/day (using default Claude Haiku model)
- Model: Configurable via CLAUDE_SKILLS_MODEL env var (defaults to claude-haiku-4-5)
- Cache TTL: 1 hour
- Cache location: `.cache/intent-analysis/`

**Files:**

- `skill-activation-prompt.ts` - Main TypeScript orchestration logic
- `lib/` - Core library modules:
  - `intent-analyzer.ts` - AI-powered intent analysis coordinator
  - `anthropic-client.ts` - Claude API integration
  - `intent-scorer.ts` - Confidence scoring and categorization
  - `keyword-matcher.ts` - Keyword-based fallback detection
  - `skill-filtration.ts` - Filtering and affinity injection
  - `skill-resolution.ts` - Dependency resolution
  - `skill-state-manager.ts` - Session state persistence
  - `output-formatter.ts` - Banner and output formatting
  - `cache-manager.ts` - Intent analysis caching
  - `constants.ts` - Configuration constants
  - `debug-logger.ts` - Debug logging
  - `schema-validator.ts` - Runtime validation
  - `types.ts` - TypeScript type definitions
- `config/intent-analysis-prompt.txt` - AI analysis prompt template
- `package.json` - NPM dependencies
- `.env.example` - API key template

## Architecture

The skill activation system uses a sophisticated multi-stage pipeline:

```
User Prompt
    ↓
┌─────────────────────────────────────┐
│ 1. Intent Analysis                  │
│    - AI analysis (Claude)           │
│    - Keyword fallback               │
│    - Cache hit/miss                 │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 2. Confidence Scoring               │
│    - Required (>0.65)               │
│    - Suggested (0.50-0.65)          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 3. Skill Filtration                 │
│    - Filter acknowledged skills     │
│    - Apply 2-skill injection limit  │
│    - Promote suggested to fill slots│
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 4. Affinity Injection               │
│    - Load complementary skills      │
│    - Bidirectional (parent↔child)   │
│    - Free of slot cost              │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 5. Dependency Resolution            │
│    - Depth-first search             │
│    - Cycle detection                │
│    - Sort by injectionOrder         │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 6. Skill Injection                  │
│    - Read SKILL.md files            │
│    - Wrap in <skill> XML tags       │
│    - Output to console              │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 7. State Management                 │
│    - Track acknowledged skills      │
│    - Prevent duplicate injection    │
└─────────────────────────────────────┘
```

## Hook Configuration

Hooks are configured through Claude Code's settings. The skill activation hook runs on the UserPromptSubmit event to automatically inject relevant skills based on prompt analysis.

## Dependencies

Install hook dependencies:

```bash
cd .claude/hooks
npm install
```

Dependencies (from `package.json`):

- `@anthropic-ai/sdk` (^0.68.0) - Anthropic API client for AI-powered intent analysis
- `typescript` (^5.3.3) - TypeScript compiler
- `tsx` (^4.7.0) - TypeScript execution
- `@types/node` (^24.10.0) - Node.js type definitions
- `vitest` (^4.0.8) - Testing framework (dev dependency)

## Troubleshooting

### Hooks not running

1. Check hook is executable (if using .sh wrapper):

   ```bash
   ls -la .claude/hooks/skill-activation-prompt.*
   ```

2. Verify dependencies:

   ```bash
   cd .claude/hooks && npm install
   ```

### TypeScript errors

Check TypeScript compilation:

```bash
cd .claude/hooks
npx tsc --noEmit
```

### Skill activation not working

1. Verify `skill-rules.json` exists:

   ```bash
   cat .claude/skills/skill-rules.json
   ```

2. Test hook manually:

   ```bash
   echo '{"session_id":"test","prompt":"write python code"}' | \
     npx tsx .claude/hooks/skill-activation-prompt.ts
   ```

3. Check for errors in debug log:

   ```bash
   cat .claude/hooks/skill-injection-debug.log
   ```

4. Enable debug mode:

   ```bash
   export CLAUDE_SKILLS_DEBUG=1
   ```

### API key issues

1. Verify `.env` file exists:

   ```bash
   cat .claude/hooks/.env
   ```

2. Check API key format starts with `sk-ant-`

3. Test API key:

   ```bash
   curl -H "x-api-key: $ANTHROPIC_API_KEY" \
     https://api.anthropic.com/v1/messages
   ```

### Cache issues

Clear intent analysis cache:

```bash
rm -rf .cache/intent-analysis/
```

### Session state issues

Clear session state:

```bash
rm -rf .claude/hooks/state/
```

## Performance Tuning

### Adjust Confidence Thresholds

Edit `.claude/hooks/lib/constants.ts`:

```typescript
export const CONFIDENCE_THRESHOLD = 0.65; // Skills auto-injected
export const SUGGESTED_THRESHOLD = 0.50; // Skills suggested
```

### Adjust Injection Limits

```typescript
export const MAX_REQUIRED_SKILLS = 2; // Max required skills per prompt
export const MAX_SUGGESTED_SKILLS = 2; // Max suggested skills per prompt
```

### Adjust Cache TTL

```typescript
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
```

## Testing

Run the test suite:

```bash
cd .claude/hooks
npm test
```

Test coverage includes:

- Intent analysis with caching
- Skill filtration and affinity injection
- Dependency resolution
- Session state management
- Output formatting
- Schema validation

## Debug Mode

Enable detailed logging:

```bash
export CLAUDE_SKILLS_DEBUG=1
```

Logs are written to `.claude/hooks/skill-injection-debug.log` with:

- Prompt analysis results
- Confidence scores per skill
- Filtration and affinity decisions
- Dependency resolution steps
- Injection outcomes

## Adding Custom Hooks

To add additional hooks for your workflow:

1. Create hook script in this directory
2. Make it executable (if shell script): `chmod +x new-hook.sh`
3. Configure the hook through Claude Code's settings
4. Test manually before relying on it

Example PostToolUse hook to track file edits:

```typescript
// post-tool-use-tracker.ts
import * as fs from "fs";

const input = JSON.parse(fs.readFileSync(0, "utf-8"));
const filePath = input.arguments?.file_path;

if (filePath) {
  fs.appendFileSync(".claude/cache/edited-files.log", `${filePath}\n`);
}
```

## Related Documentation

- Skills system overview: `.claude/skills/README.md`
- Skill rules configuration: `.claude/skills/skill-rules.json`
- Skill creation guide: `.claude/skills/skill-developer/SKILL.md`
- Main project README: `../README.md`
- Architecture documentation: `docs/ARCHITECTURE.md`

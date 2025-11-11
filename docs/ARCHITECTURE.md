# Architecture Documentation

This document explains the internal architecture of the Claude Skills
Supercharged system.

## System Overview

The skills system consists of three main components:

1. **Hook System** - UserPromptSubmit hook that intercepts prompts
2. **Skills** - Markdown files with domain-specific guidance
3. **Configuration** - JSON rules defining triggers and behavior

```
┌─────────────────────────────────────────────┐
│ User submits prompt in Claude Code          │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ UserPromptSubmit Hook Triggered             │
│ (.claude/hooks/skill-activation-prompt.ts)  │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Multi-Stage Injection Pipeline              │
│ (13 TypeScript modules)                     │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Skills Injected into Context                │
│ (SKILL.md wrapped in <skill> tags)          │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Claude receives enriched context            │
└─────────────────────────────────────────────┘
```

## Injection Pipeline

The injection pipeline consists of 7 stages:

### Stage 1: Intent Analysis

**File:** `lib/intent-analyzer.ts`

Analyzes the user's prompt to determine intent:

1. **Check cache** - MD5 hash of (prompt + skills config)
   - Cache hit → Return cached result (<10ms)
   - Cache miss → Continue to analysis

2. **Short prompt check** - If prompt ≤10 words
   - Use keyword matching (fast, cheap)
   - Skip AI analysis

3. **AI analysis** - For longer prompts
   - Call Claude Haiku 4.5 via Anthropic SDK
   - Use prompt template from `config/intent-analysis-prompt.txt`
   - Parse JSON response with confidence scores

4. **Fallback** - If AI fails
   - Fall back to keyword matching
   - Ensures system always works

**Key files:**
- `lib/intent-analyzer.ts` - Orchestrates analysis
- `lib/anthropic-client.ts` - API integration
- `lib/keyword-matcher.ts` - Fallback matching
- `lib/cache-manager.ts` - Caching logic

### Stage 2: Confidence Scoring

**File:** `lib/intent-scorer.ts`

Categorizes skills by confidence threshold:

```typescript
if (score > 0.65) {
  category = "required"; // Auto-inject
} else if (score > 0.50) {
  category = "suggested"; // Show as optional
} else {
  category = "ignored"; // Don't show
}
```

**Output:** `AnalysisResult` with skills grouped by category

### Stage 3: Skill Filtration

**File:** `lib/skill-filtration.ts`

Applies filtration rules:

1. **Filter acknowledged skills** - Skip skills already loaded in this
   conversation
2. **Apply injection limit** - Max 2 skills per prompt (configurable)
3. **Promote suggested skills** - If slots available, promote from "suggested"
   to "required"

**Example:**
```
Input: 4 required skills
Limit: 2 skills max
Output: Top 2 highest confidence skills
```

### Stage 4: Affinity Injection

**File:** `lib/skill-filtration.ts` (continued)

Loads related skills automatically at **no slot cost** (bonus injections):

```json
{
  "skill-a": {
    "affinity": ["skill-b", "skill-c"]
  }
}
```

**Rules:**
- **Bidirectional:** If A → B, then B → A (works both ways automatically)
- **Free of slot cost:** Affinity skills don't count against the 2-skill
  injection limit
- **Max 2 affinities per skill** (recommended)

**Example:**
```
User prompt triggers "api-security"
api-security has affinity: ["python-best-practices"]
Both skills loaded automatically (1 required + 1 affinity bonus = 2 total, uses 1 slot)
```

**Why this matters:** Affinity lets you load 3+ skills while only using 1-2
injection slots, maximizing context without hitting the limit.

> 💡 **Decision guide:** See
> [CREATING-SKILLS.md](CREATING-SKILLS.md#understanding-requiredskills-vs-affinity)
> for when to use affinity vs requiredSkills

### Stage 5: Dependency Resolution

**File:** `lib/skill-resolution.ts`

Resolves `requiredSkills` dependencies (hard dependencies):

1. **Depth-first search** - Traverse dependency tree
2. **Cycle detection** - Prevent infinite loops
3. **Sort by injectionOrder** - Deterministic ordering (0-100)

**Key difference from affinity:**
- **Unidirectional:** If A requires B, only A→B exists (not bidirectional)
- **Guaranteed ordering:** Dependencies always load before dependent skills
- **Counts toward slot limit:** Each required skill uses an injection slot

**Example:**
```json
{
  "skill-a": {"requiredSkills": ["skill-b"]},
  "skill-b": {"requiredSkills": ["skill-c"]},
  "skill-c": {"requiredSkills": []}
}
```

Resolution order: `skill-c` → `skill-b` → `skill-a`

> 💡 **Decision guide:** See
> [CREATING-SKILLS.md](CREATING-SKILLS.md#understanding-requiredskills-vs-affinity)
> for when to use requiredSkills vs affinity

### Stage 6: Skill Injection

**File:** `lib/output-formatter.ts`

Loads and formats skill content:

1. **Read SKILL.md files** - Load from filesystem
2. **Wrap in XML tags** - `<skill name="...">...</skill>`
3. **Format banner** - Show which skills loaded
4. **Output to stdout** - Claude reads and processes

**Output format:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 AUTO-LOADED SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<skill name="skill-name">
[Skill content here...]
</skill>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Stage 7: State Management

**File:** `lib/skill-state-manager.ts`

Tracks loaded skills per conversation:

1. **Read state file** -
   `.claude/hooks/state/{conversation-id}-skills-suggested.json`
2. **Add new skills** - Append newly loaded skills
3. **Write atomically** - Temp file + rename for safety

**State format:**
```json
{
  "conversation_id": "abc123",
  "acknowledged_skills": ["skill-a", "skill-b"],
  "timestamp": "2025-01-11T12:00:00Z"
}
```

## Core Modules

### Types (`lib/types.ts`)

Defines TypeScript interfaces for the entire system:

```typescript
interface SkillRule {
  type: "domain" | "guardrail";
  autoInject: boolean;
  requiredSkills: string[];
  affinity?: string[];
  promptTriggers?: {
    keywords?: string[];
  };
}

interface IntentAnalysis {
  skillScores: Record<string, number>; // 0.0-1.0
  reasoning: string;
}

interface AnalysisResult {
  required: string[]; // >0.65
  suggested: string[]; // 0.50-0.65
  details: Record<string, {score: number; reason: string}>;
}
```

### Constants (`lib/constants.ts`)

Configuration constants:

```typescript
export const CONFIDENCE_THRESHOLD = 0.65;
export const SUGGESTED_THRESHOLD = 0.50;
export const MAX_REQUIRED_SKILLS = 2;
export const MAX_SUGGESTED_SKILLS = 2;
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const SHORT_PROMPT_THRESHOLD = 10; // words
```

### Debug Logger (`lib/debug-logger.ts`)

Conditional logging:

```typescript
if (process.env.CLAUDE_SKILLS_DEBUG === "1") {
  writeToLog(`[INFO] ${message}`);
}
```

Logs written to: `.claude/hooks/skill-injection-debug.log`

Auto-rotates at 10MB

### Schema Validator (`lib/schema-validator.ts`)

Runtime validation of `skill-rules.json`:

```typescript
validateSkillRules(rules: SkillRulesConfig): void {
  // Check required fields
  // Validate types
  // Enforce affinity limits
  // Detect cycles in requiredSkills
}
```

## Configuration

### skill-rules.json Schema

```json
{
  "version": "1.0",
  "skills": {
    "skill-name": {
      "type": "domain" | "guardrail",
      "autoInject": boolean,
      "requiredSkills": string[],
      "affinity": string[] (max 2),
      "description": string,
      "promptTriggers": {
        "keywords": string[]
      }
    }
  }
}
```

### intent-analysis-prompt.txt Template

AI analysis prompt with:
- Task description
- Confidence scoring guidance (0.0-1.0)
- Output format (JSON)
- Examples of analysis

Variables substituted:
- `{SKILLS_JSON}` - Full skill-rules.json
- `{USER_PROMPT}` - User's prompt

## Skill Types

The system supports two skill types:

### Domain Skills

**Characteristics:**
- `type: "domain"`
- `autoInject: true`
- Automatically injected when detected
- Respect injection limits
- Session-aware (inject once per conversation)

**Examples:** `python-best-practices`, `api-security`, `git-workflow`,
`skill-developer`

**Use case:** Domain-specific guidance and system maintenance

### Guardrail Skills

**Characteristics:**
- `type: "guardrail"`
- Automatically injected when detected
- Enforce critical best practices
- Session-aware (inject once per conversation)

**Examples:** `api-security` (when configured as guardrail)

**Use case:** Preventing critical errors and enforcing best practices

## Caching Strategy

### Intent Analysis Cache

**Location:** `.cache/intent-analysis/`

**Key:** MD5 hash of `${prompt}_${JSON.stringify(skillRules)}`

**Value:**
```json
{
  "analysis": {
    "skillScores": {"skill-a": 0.85, "skill-b": 0.45},
    "reasoning": "User wants to write Python code..."
  },
  "timestamp": 1704985200000
}
```

**TTL:** 1 hour (configurable)

**Cleanup:** Automatic removal of entries >24 hours old

### Session State Cache

**Location:** `.claude/hooks/state/{conversation-id}-skills-suggested.json`

**Lifetime:** Duration of conversation

**Purpose:** Prevent duplicate skill injection

## Performance Characteristics

### Timing Breakdown

1. **Cache hit:** ~5-10ms
2. **Keyword matching:** ~20-50ms
3. **AI analysis (first time):** ~150-250ms
4. **Skill injection:** ~10-30ms per skill
5. **Total (cached):** ~50-100ms
6. **Total (uncached):** ~200-350ms

### Cost Analysis

**AI analysis cost:**
- Model: Claude Haiku 4.5
- Input: ~2,000 tokens (prompt + skills config)
- Output: ~200 tokens (JSON response)
- Cost: ~$0.0003 per analysis

**Monthly cost at 100 prompts/day:**
- Total analyses: ~3,000/month
- Cache hit rate: ~70%
- Actual API calls: ~900/month
- Total cost: ~$0.27/month

With cache, costs are minimal.

## Error Handling

### Graceful Degradation

```
AI analysis fails
    ↓
Fall back to keyword matching
    ↓
Keyword matching fails
    ↓
Return empty skill list (system continues)
```

### Error Logging

All errors logged to debug log:

```
[ERROR] Failed to analyze intent: API timeout
[INFO] Falling back to keyword matching
[WARN] No skills matched for prompt
```

## Security Considerations

1. **API Key Storage:** `.env` file (gitignored)
2. **Input Validation:** Schema validation for skill-rules.json
3. **Output Sanitization:** No user input in skill content
4. **File Access:** Limited to `.claude/` directory
5. **Cache Integrity:** Atomic writes for state files

## Extensibility Points

### Custom Confidence Scoring

Override in `lib/intent-scorer.ts`:

```typescript
function calculateCustomScore(analysis: IntentAnalysis): number {
  // Custom scoring logic
}
```

### Alternative AI Models

Configure via `CLAUDE_SKILLS_MODEL` environment variable:

```bash
# In .claude/hooks/.env
CLAUDE_SKILLS_MODEL=claude-sonnet-4-5  # Use Sonnet
CLAUDE_SKILLS_MODEL=claude-opus-4      # Use Opus
```

Available models:
- `claude-haiku-4-5` (default: fast, cheap, accurate)
- `claude-sonnet-4-5` (more capable, higher cost)
- `claude-opus-4` (highest cost, *not* recommended for this use case)

## Testing Architecture

### Test Coverage

- **Unit tests:** 11 test files covering all modules
- **Integration tests:** End-to-end pipeline tests
- **Test framework:** Vitest

### Test Structure

```
lib/__tests__/
├── intent-analyzer.test.ts      # AI analysis
├── cache.test.ts                 # Caching logic
├── skill-filtering.test.ts       # Filtration rules
├── affinity-injection.test.ts    # Affinity loading
├── dependency-resolution.test.ts # Dependency graph
├── session-state.test.ts         # State management
└── ...
```

### Running Tests

```bash
npm test                    # All tests
npm test -- intent-analyzer # Specific test
npm test -- --coverage      # With coverage
```

## Future Enhancements

Potential improvements:

1. **Embeddings-based matching** - Use vector similarity instead of keywords
2. **Learning from feedback** - Track which skills were useful
3. **Multi-language support** - Localize skill content
4. **Skill versioning** - Track skill changes over time
5. **Analytics dashboard** - Visualize skill usage patterns

## Related Documentation

- [GETTING-STARTED.md](GETTING-STARTED.md) - Setup and basic usage
- [CREATING-SKILLS.md](CREATING-SKILLS.md) - Authoring custom skills
- [skill-developer/SKILL.md](../.claude/skills/skill-developer/SKILL.md) - Skill
  system reference

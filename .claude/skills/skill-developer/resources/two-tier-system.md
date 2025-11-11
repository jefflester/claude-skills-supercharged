# Two-Tier Skill System

Complete guide to the meta-skills vs domain-skills distinction and automatic skill detection.

Note: Meta-skills refer to system-awareness skills like `skill-developer` that provide passive awareness rather than actionable domain guidance.

## Overview

The system supports two skill types with different purposes:

### Domain Skills (Actionable Guidance, Auto-Injected)

**Purpose:** Provide specific technical guidance for tasks

**Characteristics:**

- Detected based on prompt keywords and AI intent analysis
- Automatically injected when detected (`autoInject: true`)
- Up to 2 CRITICAL skills injected per prompt (3 with affinity bonus)
- RECOMMENDED skills shown but not injected
- Provide actionable domain-specific guidance

**Affinity Bonus:**

Skills can declare complementary relationships via `affinity` configuration. When complementary skills are detected together, the injection limit increases from 2 to 3, allowing both related skills to load.

**Example:** `frontend-framework` declares affinity with `api-protocols`. When a prompt triggers both skills (e.g., "Fix API integration in React component"), both inject even though it exceeds the standard 2-skill limit.

**Examples:**

- `frontend-framework`
- `testing-strategy`
- `integration-tools`
- `backend-development`
- `licensing-system`

**When detected:** Automatically inject skill content into context (no manual Skill tool call needed)

## Automatic Skill Detection

**You never need to explicitly request skills.** The system automatically detects them through:

### 1. Keyword Matching

Prompt is analyzed for domain-specific keywords defined in `skill-rules.json`:

```json
"service-layer-development": {
  "promptTriggers": {
    "keywords": ["service", "api handler", "REST", "authentication", "authorization"]
  }
}
```

**Example:**

- Prompt: "Fix the authentication service cleanup issue"
- Detected: `service-layer-development` (keyword: "service")


## AI-Powered Intent Analysis

**Overview:**

The skill detection system uses Claude Haiku 4.5 to analyze prompt intent and assign confidence scores to skills, dramatically reducing false positives from keyword matching.

### How It Works

1. User submits prompt
1. AI analyzes PRIMARY task intent
1. Assigns confidence scores (0.0-1.0) to each skill
1. High confidence (>0.65) → CRITICAL (must acknowledge)
1. Medium confidence (0.3-0.65) → RECOMMENDED (optional)

### Setup Requirements

**API Key Configuration:**

1. Create `.claude/hooks/.env` file:

   ```bash
   cp .claude/hooks/.env.example .claude/hooks/.env
   ```

1. Add your Anthropic API key:

   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

1. Get API key from https://console.anthropic.com/

**Note:** API key is **required**. The hook will fail with helpful setup instructions if missing.

### Performance

- **Latency:** ~200ms (first call), \<10ms (cached) - 4-5x faster than Sonnet 4.5
- **Cost:** ~$0.0015 per analysis (Haiku 4.5 pricing: $1/\$5 per million tokens)
- **Cache TTL:** 1 hour
- **Cache location:** `.cache/intent-analysis/`
- **Monthly cost:** ~\$1-2 at 100 prompts/day

### Error Handling

- **Missing API key:** Hook fails with helpful setup instructions
- **API errors:** Falls back to keyword matching automatically
- **Cache errors:** Ignored, fetches fresh from API
- **Network errors:** Falls back to keyword matching

### Example: False Positive Elimination

**Before (keyword matching):**

```
Prompt: "Fix precommit issues in skills system"

Detected skills:
  ⚠️ frontend-framework (false positive - "framework" in file path)
  ⚠️ api-protocols (false positive - "protocol" in error)
  ⚠️ ci-cd-workflows (false positive - "workflow" mention)
  ✅ skill-developer (correct)
```

**After (AI intent analysis):**

```
Prompt: "Fix precommit issues in skills system"

AI Analysis:
  Primary intent: "Fix skill system configuration"

Detected skills:
  ✅ skill-developer (0.95 confidence - primary intent is skill work)

Result: No false positives!
```

### Implementation Details

**Core Logic:** `.claude/hooks/lib/intent-analyzer.ts`

```typescript
// AI analyzes prompt with skill descriptions
const analysis = await analyzeIntent(userPrompt, skillRules);

// Categorize by confidence
const required = analysis.skills.filter(s => s.confidence > 0.65);
const suggested = analysis.skills.filter(s => s.confidence >= 0.3 && s.confidence <= 0.65);
```

**Prompt Engineering:**

The AI receives:

- User's prompt
- Available skills with descriptions
- Instructions to focus on PRIMARY task intent
- Guidance to distinguish main task from passing mentions

**Caching Strategy:**

- MD5 hash of prompt as cache key
- 1-hour TTL to balance freshness vs cost
- Automatic cache directory creation
- Read-through cache pattern

## Hook Flow

### UserPromptSubmit Hook (Detection)

**When:** Before Claude sees your prompt

**Process:**

1. Analyze prompt for keywords and AI intent
1. Identify relevant domain skills and meta-skills
1. Auto-inject CRITICAL domain skills that exceed 0.65 confidence threshold
1. Show RECOMMENDED skills (0.3-0.65 confidence) for optional loading

**Output Example:**

```
📚 AUTO-LOADED SKILLS

<skill name="service-layer-development">
[Skill content automatically injected...]
</skill>
```


## Workflow Examples

### Scenario 1: Generic prompt (no domain skills)

**User prompt:** "What's the status of the project?"

**Detection:**

- Keywords: None matching domain skills
- Intent: Informational query
- Result: Only `skill-developer` suggested

**User experience:** ✅ No friction, immediate answer

### Scenario 2: Domain-specific prompt

**User prompt:** "Fix the authentication service cleanup issue"

**Detection:**

- Keywords: "service", "authentication"
- AI analysis: High confidence (0.85) for service layer work
- Result: `service-layer-development` marked as CRITICAL

**Auto-Injection:**

- CRITICAL skill → Automatically inject `service-layer-development` skill content
- Flow: Skill content loaded before agent responds, no manual action needed

**User experience:** ✅ Instant access to relevant expertise, zero friction

### Scenario 3: Multi-domain prompt

**User prompt:** "Add E2E tests for the Express framework"

**Detection:**

- Keywords: "E2E", "tests", "Express", "framework"
- Intent: "Add.\*test" pattern
- AI analysis: `testing-strategy` (0.92 critical), `ci-cd-workflows` (0.45 recommended)

**Auto-Injection:**

- CRITICAL: `testing-strategy` → Auto-inject
- RECOMMENDED: `ci-cd-workflows` → Show but don't inject (agent can manually load if needed)
- Flow: Critical skill injected, recommended skill suggested

**User experience:** ✅ Primary guidance auto-loaded, optional context available

## Session State Management

**State file location:** `.claude/hooks/state/{session_id}-skills-suggested.json`

**State structure:**

```json
{
  "timestamp": 1699564800000,
  "suggestedSkills": [],
  "recommendedSkills": [],
  "acknowledged": true,
  "acknowledgedSkills": ["service-layer-development", "testing-strategy"],
  "injectedSkills": ["service-layer-development", "testing-strategy"],
  "injectionTimestamp": 1699564800000
}
```

**State lifecycle:**

1. UserPromptSubmit detects skills via AI analysis
1. CRITICAL skills (up to 2) are automatically injected
1. Injected skills tracked in `acknowledgedSkills` and `injectedSkills` arrays
1. RECOMMENDED skills shown but not injected
1. Subsequent prompts reuse already-injected skills (no duplicate injection)
1. State persists for conversation duration

## Benefits of Two-Tier System

### For Users

**Zero friction on all prompts:**

- Questions, status checks, explanations → instant responses
- Domain work → skills auto-loaded transparently
- No manual Skill tool calls needed

**Guaranteed expertise on domain prompts:**

- Technical work → automatically receive relevant guidance
- Up to 2 CRITICAL skills injected per prompt
- RECOMMENDED skills suggested for optional loading
- 95% of technical prompts get proper skill coverage

**Transparent and seamless:**

- Clear "📚 AUTO-LOADED SKILLS" banner shows what was injected
- One-time injection per conversation per skill
- Meta-skills provide passive awareness without content injection

### For Skill System

**Optimal signal-to-noise ratio:**

- Meta-skills always present (background awareness)
- Domain skills auto-injected when relevant
- Up to 2 CRITICAL skills per prompt (prevents context overload)

**Maintains skill coverage goals:**

- ~95% of technical prompts covered by auto-injected skills
- ~5% generic prompts flow without injection
- 100% prompts have meta-skill awareness

**Clear separation of concerns:**

- Meta-skills = passive awareness (not injected)
- Domain skills = active guidance (auto-injected when CRITICAL)
- Each tier has distinct purpose and behavior

## Adding New Skills

### Default: Domain Skill

Most skills should be domain skills (auto-injected when detected):

```json
"my-new-skill": {
  "type": "domain",
  "enforcement": "suggest",
  "priority": "medium",
  "autoInject": true,
  "requiredSkills": [],
  "promptTriggers": {
    "keywords": ["relevant", "keywords"]
  }
}
```

### Rare: Meta-Skill

Only create a meta-skill if it:

- Is always relevant to every prompt
- Provides passive awareness, not actionable guidance
- Should NOT be injected (`autoInject: false`)

**Current meta-skills:**

- `skill-developer` (skills system awareness)

**To add a new meta-skill:**

1. Add to skill-rules.json with `autoInject: false` and `type: "meta"`
1. Document why it's a meta-skill (high bar to justify)

## Troubleshooting

### Skill not auto-injecting when it should

**Check:**

1. Is `autoInject: true` in skill-rules.json? (should be for domain skills)
1. Is UserPromptSubmit detecting it? (check hook output for skill name)
1. Is AI analysis marking it as CRITICAL (>0.65 confidence)?
1. Already injected this conversation? (check state file)

### Skill injecting when it shouldn't

**Check:**

1. Should this be a meta-skill instead? (is it truly passive awareness that applies to all prompts?)
1. Are triggers too broad? (refine keywords)
1. Is it really domain guidance or meta-awareness?

## Implementation Files

**Hook files:**

- `.claude/hooks/skill-activation-prompt.ts` - Detects skills and auto-injects CRITICAL domain skills

**Configuration:**

- `.claude/skills/skill-rules.json` - Skill trigger definitions

**Key code locations:**

- Skill detection logic: `.claude/hooks/lib/intent-analyzer.ts`
- CRITICAL skill auto-injection: `.claude/hooks/skill-activation-prompt.ts`

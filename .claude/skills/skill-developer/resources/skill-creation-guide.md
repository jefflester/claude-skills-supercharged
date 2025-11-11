# Skill Creation Guide

Step-by-step guide for creating new skills in the Claude Code skills system.

## Quick Start Process

**5 steps to create a skill:**

1. Create SKILL.md with frontmatter
1. Add to skill-rules.json
1. Test triggers
1. Refine patterns
1. Keep under 500 lines

## Step 1: Create Skill File

### File Location

`.claude/skills/{skill-name}/SKILL.md`

**Naming conventions:**

- Lowercase only
- Use hyphens for spaces
- Gerund form preferred (verb + -ing): `testing-strategy`, `code-patterns`
- Descriptive and specific: `api-integration` not just `api`

### YAML Frontmatter Template

Every skill file must start with YAML frontmatter:

```markdown
---
name: my-new-skill
description: Brief description including keywords that trigger this skill. Mention topics, file types, and use cases. Be explicit about trigger terms.
---
```

**Description field:**

- Maximum 1024 characters
- Include ALL trigger keywords
- Mention file types if applicable
- List use cases and scenarios
- Be explicit about domain coverage

**Example:**

```yaml
---
name: frontend-framework
description: Comprehensive guide for developing frontend components using modern frameworks (React/Vue/Angular). Use when working with component architecture, state management, lifecycle methods, routing, props/events, or troubleshooting component issues. Covers component-based design, hooks patterns, and performance optimization.
---
```

### Content Structure Template

```markdown
# My New Skill

## Purpose
What this skill helps with (1-2 sentences)

## When to Use
Specific scenarios and conditions:
- Scenario 1
- Scenario 2
- Scenario 3

## Related Skills
Links to complementary skills

## Key Information
The actual guidance, patterns, examples

## Resources
Links to resource files for deep dives
```

### Best Practices

**Content organization:**

- ✅ Clear, descriptive section headings
- ✅ Bullet lists for scannability
- ✅ Code blocks with syntax highlighting
- ✅ Real examples from the codebase
- ✅ Progressive disclosure (summary → details in resources)

**Line count:**

- ✅ Target: Under 500 lines
- ✅ Extract detailed content to `resources/` subdirectory
- ✅ Use concise summaries, link to resource files
- ✅ Remove redundancy and wordiness

**Forbidden:**

- ❌ Table of contents (agents don't need them)
- ❌ Line number references (change too frequently)
- ❌ Heading navigation links (agents scan natively)

## Step 2: Add to skill-rules.json

### File Location

`.claude/skills/skill-rules.json`

### Basic Template

```json
{
  "my-new-skill": {
    "type": "domain",
    "promptTriggers": {
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  }
}
```

### Field Explanations

**type:** (required)

- `"domain"` - Most skills (actionable guidance)
- `"guardrail"` - Critical prevention (rare)

**affinity:** (optional)

Array of skill names (max 2) that work well together and should be auto-injected bidirectionally.

**Use when:** Skills are frequently needed together (e.g., frontend-framework + api-integration).
**Effect:** When a skill is injected, its affinity skills are also auto-injected (free of slot cost).

**promptTriggers:** (optional but recommended)

- `keywords` - Explicit terms (case-insensitive)

### Complete Example

```json
{
  "frontend-framework": {
    "type": "domain",
    "affinity": ["api-integration", "code-patterns"],
    "promptTriggers": {
      "keywords": [
        "component",
        "frontend",
        "React",
        "Vue",
        "hooks",
        "state management",
        "props",
        "routing"
      ]
    }
  }
}
```

## Step 3: Test Triggers

### Test UserPromptSubmit Hook

Tests if your skill is detected for a given prompt:

```bash
echo '{"session_id":"test","prompt":"your test prompt here"}' | \
  npx tsx .claude/hooks/skill-activation-prompt.ts
```

**Example:**

```bash
echo '{"session_id":"test","prompt":"Fix the authentication service"}' | \
  npx tsx .claude/hooks/skill-activation-prompt.ts
```

**Expected output:**

```
🎯 SKILL ACTIVATION CHECK

📚 RECOMMENDED SKILLS:
  → service-layer-development
```

### Testing Checklist

Test each trigger type:

- [ ] Keyword triggers (multiple keywords)

Test edge cases:

- [ ] Related but non-triggering prompts (false positive check)
- [ ] Case variations (keywords are case-insensitive)
- [ ] Partial matches (do keywords work as expected?)

## Step 4: Refine Keywords

Based on testing results, iterate:

### Add Missing Keywords

If skill should trigger but doesn't:

```json
"keywords": [
  "original keyword",
  "synonym1",
  "synonym2",
  "common abbreviation"
]
```

### Reduce False Positives

If skill triggers when it shouldn't, make keywords more specific:

```json
// Too broad
"keywords": ["test"]

// More specific
"keywords": ["E2E test", "integration test", "test framework"]
```

### Balance Coverage vs Precision

**Goal:** Trigger on relevant prompts, ignore unrelated ones

**Metrics:**

- True positives: Triggers when skill is helpful ✅
- False positives: Triggers when skill isn't needed ❌
- False negatives: Doesn't trigger when skill would help ❌

**Iterate until:** High true positive rate, low false positive rate

## Step 5: Follow Best Practices

### Keep Under 500 Lines

**Check line count:**

```bash
wc -l .claude/skills/my-new-skill/SKILL.md
```

**If over 500:**

1. Extract detailed examples → `resources/EXAMPLES.md`
1. Move deep-dive content → `resources/advanced.md`
1. Create topic-specific resources → `resources/SPECIFIC_TOPIC.md`
1. Keep only essential summary in main SKILL.md

### Use Progressive Disclosure

**Main SKILL.md:**

- High-level overview
- When to use this skill
- Quick reference
- Links to resource files

**Resource files:**

- Detailed examples
- Deep-dive explanations
- Advanced topics
- Troubleshooting guides

**Example:**

```markdown
## Key Concepts

Brief explanation of concept (2-3 sentences).

For complete details, see the resource file for this topic.
```

### Test with Real Scenarios

**Before writing extensive documentation:**

1. Use skill with 3+ real tasks
1. Identify what information is actually needed
1. Note what's missing or unclear
1. Iterate based on actual usage

**Don't:** Write comprehensive docs first, then realize they're not helpful

**Do:** Test with real scenarios, then document what works

### Validate Schema

Check skill-rules.json syntax:

```bash
python .github/scripts/quick_validate_versions.py  # Validates JSON syntax
```

Or use a JSON validator:

```bash
cat .claude/skills/skill-rules.json | python -m json.tool > /dev/null
```

## Skill Types: When to Use Each

### Domain Skills (Most Common)

**Use when:**

- Providing technical guidance for specific area
- Documenting architectural patterns
- Explaining how to use a system
- Best practices for a technology

**Examples:**

- `service-layer-development`
- `testing-strategy`
- `integration-tools`
- `backend-development`

**Configuration:**

```json
{
  "type": "domain"
}
```

### Guardrail Skills (Rare)

**Use when:**

- Preventing critical errors
- Enforcing data integrity
- Blocking dangerous operations
- Compatibility requirements

**Examples:**

- `database-verification` (prevent wrong column names)
- `api-versioning` (prevent breaking changes)

**Configuration:**

```json
{
  "type": "guardrail"
}
```

**High bar:** Only create guardrails for errors that:

- Cause runtime failures
- Corrupt data
- Break critical workflows
- Can't be easily fixed after the fact

## Common Mistakes

### Mistake 1: Too Many Keywords

**Problem:**

```json
"keywords": [
  "test", "tests", "testing", "tester", "testable",
  "spec", "specs", "specification", "specifications",
  // ... 50 more keywords
]
```

**Solution:** Be selective, use representative terms:

```json
"keywords": ["test", "E2E", "integration test", "test framework"]
```

### Mistake 2: Not Testing Edge Cases

**Problem:** Only test happy path

**Solution:** Test variations:

- Different phrasings
- Related but non-matching prompts
- Case variations
- Partial matches

### Mistake 4: Kitchen Sink Documentation

**Problem:** Put everything in main SKILL.md → 800+ lines

**Solution:** Progressive disclosure:

- Main file: < 500 lines, essentials only
- Resource files: Detailed deep dives
- Clear navigation between files

### Mistake 5: Forgetting to Update Description

**Problem:** Add keywords to skill-rules.json, forget to update SKILL.md description

**Solution:** Keep description and keywords in sync:

- Description mentions all major topics
- Keywords reflect description content
- Update both when adding new coverage

## Skill Maintenance

### When to Update Skills

**Trigger updates when:**

- New terminology introduced → Add `keywords`
- New docs created → Link in resources
- Skill drift detected → Refactor content

### Manual Checks

- Line count monitoring
- Test trigger accuracy

### Refactoring

**Signs skill needs refactoring:**

- Approaching 500 lines
- Becoming too broad (many unrelated topics)
- Outdated examples or patterns

**Refactoring strategies:**

- Split into multiple focused skills
- Extract content to resource files
- Update examples to current code

## Quick Reference

**File locations:**

- Skill content: `.claude/skills/{name}/SKILL.md`
- Configuration: `.claude/skills/skill-rules.json`
- Resources: `.claude/skills/{name}/resources/*.md`

**Testing commands:**

```bash
# Test detection
echo '{"session_id":"test","prompt":"test prompt"}' | \
  npx tsx .claude/hooks/skill-activation-prompt.ts

# Check line count
wc -l .claude/skills/{name}/SKILL.md

# Validate JSON
cat .claude/skills/skill-rules.json | python -m json.tool
```

**Remember:**

- Keep main file < 500 lines
- Test with real scenarios first
- Use progressive disclosure
- Iterate based on usage
- Update triggers as code evolves

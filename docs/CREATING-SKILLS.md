# Creating Custom Skills

This guide shows you how to create effective custom skills for your project
using the Claude Skills Supercharged system.

## Skill Anatomy

A skill consists of two parts:

1. **SKILL.md** - The skill content (markdown with YAML frontmatter)
2. **skill-rules.json entry** - Configuration defining when to activate

### Basic Structure

```
.claude/skills/
└── my-skill/
    ├── SKILL.md              # Main skill content (<500 lines)
    └── resources/             # Optional detailed content
        ├── patterns.md
        └── examples.md
```

## Step-by-Step Guide

### Step 1: Plan Your Skill

Ask yourself:

1. **What domain does this cover?** (e.g., testing, database, frontend)
2. **When should it activate?** (keywords, AI intent analysis)
3. **What guidance does it provide?** (patterns, examples, pitfalls)
4. **Who is the audience?** (beginners, experts, or both)

### Step 2: Create Skill Directory

```bash
mkdir -p .claude/skills/my-skill/resources
```

### Step 3: Write SKILL.md

Create `.claude/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: One-sentence description of what this skill does
---

# My Skill Title

## Purpose

Clear explanation of what this skill helps with.

## When to Use This Skill

Auto-activates when:

- Condition 1
- Condition 2
- Condition 3

## Section 1: Core Concepts

Explain key concepts...

## Section 2: Patterns and Examples

Provide working code examples...

## Section 3: Common Pitfalls

What to avoid...

## Key Takeaways

Summary of main points (numbered list)
```

### Step 4: Add to skill-rules.json

Add entry in `.claude/skills/skill-rules.json`:

```json
{
  "version": "1.0",
  "skills": {
    "my-skill": {
      "type": "domain",
      "autoInject": true,
      "requiredSkills": [],
      "description": "Brief description for AI analysis",
      "promptTriggers": {
        "keywords": [
          "keyword1",
          "keyword2",
          "related term"
        ]
      }
    }
  }
}
```

### Step 5: Test Activation

```bash
cd .claude/hooks

# Test with prompt
echo '{"session_id":"test","prompt":"help with keyword1"}' | \
  npx tsx skill-activation-prompt.ts

# Should see your skill in output
```

### Step 6: Iterate and Refine

1. Try different prompts
2. Check if skill activates appropriately
3. Refine keywords and descriptions for better intent matching
4. Add more examples to SKILL.md

## Skill Types

### Domain Skills

**Purpose:** Comprehensive guidance for specific areas

**Characteristics:**
- `type: "domain"`
- Advisory, not mandatory
- Most common type

**Example:** `python-best-practices`, `git-workflow`

**When to use:** General guidance, best practices, patterns

### Guardrail Skills

**Purpose:** Enforce critical practices

**Characteristics:**
- `type: "guardrail"`
- High-priority guidance
- Use sparingly

**Example:** `api-security`

**When to use:** Security, data integrity, critical errors

## The 500-Line Rule

**ALL skill files must stay under 500 lines.**

### Why 500 Lines?

- Agents process files linearly
- Long files waste tokens and context
- 500 lines is the sweet spot for scannable content
- Forces you to be concise and focused

### Staying Under 500 Lines

**Use progressive disclosure:**

```
my-skill/
├── SKILL.md (450 lines)
│   ├── Purpose
│   ├── When to Use
│   ├── Quick Start
│   ├── Core Concepts (concise)
│   ├── Common Patterns (summaries)
│   └── Key Takeaways
└── resources/
    ├── patterns.md (detailed patterns)
    └── code-examples.md (extensive examples)
```

**Reference resources from main skill:**

```markdown
## Advanced Topics

For detailed information on advanced topics, see [advanced-topics.md](resources/advanced-topics.md).
```

**Hard limits:**
- ✅ Target: Under 500 lines
- ⚠️ Warning: Max 5 files can breach 500 (across all skills)
- 🚫 Never: No file should ever breach 600 lines

## Writing Effective Triggers

### Keywords

Simple string matching in prompts.

**Good keywords:**
```json
"keywords": [
  "database migration",
  "Alembic",
  "schema change",
  "migrate database"
]
```

**Avoid:**
- Too generic: "database", "code", "function"
- Too specific: "run_migration_v2_final"


## Skill Content Best Practices

### 1. Start with Purpose

Make it immediately clear what the skill does:

```markdown
## Purpose

This skill provides guidance on database migrations using Alembic.
It covers creating migrations, handling conflicts, and testing schema changes.
```

### 2. Clear Activation Conditions

Tell Claude when to use this:

```markdown
## When to Use This Skill

Auto-activates when:

- Creating or modifying database migrations
- Working with Alembic version files
- Debugging migration conflicts
- Planning schema changes
```

### 3. Provide Working Examples

Code examples are crucial:

```markdown
## Creating a Migration

\`\`\`python
from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_table(
        'users',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True)
    )

def downgrade():
    op.drop_table('users')
\`\`\`
```

### 4. Show Do's and Don'ts

Contrast good vs bad:

```markdown
## Common Pitfalls

\`\`\`python
# BAD - No downgrade
def downgrade():
    pass  # What if migration fails?

# GOOD - Proper downgrade
def downgrade():
    op.drop_table('users')  # Reverses upgrade
\`\`\`
```

### 5. End with Key Takeaways

Summarize in a numbered list:

```markdown
## Key Takeaways

1. Always implement both upgrade() and downgrade()
2. Test migrations on staging before production
3. Use batch operations for large tables
4. Never delete old migration files
5. Document breaking changes in docstrings
```

### 6. Use Consistent Structure

Follow this template:

```markdown
# Skill Title

## Purpose
[What it does]

## When to Use This Skill
[Activation conditions]

## Core Concept 1
[Explanation + example]

## Core Concept 2
[Explanation + example]

## Common Pitfalls
[Do's and don'ts]

## Key Takeaways
[Numbered summary]
```

## Advanced Features

### Understanding requiredSkills vs affinity

Two powerful mechanisms for loading related skills:

| Aspect | requiredSkills | affinity |
|--------|---------------|----------|
| **Purpose** | Hard dependencies | Complementary skills |
| **Direction** | Unidirectional (A→B only) | Bidirectional (A↔B both ways) |
| **Slot cost** | Counts toward 2-skill limit | **FREE** - bonus injections |
| **Ordering** | Dependencies load first | No guaranteed order |
| **Use case** | "A requires B to function" | "A and B work great together" |
| **Max** | Unlimited | 2 per skill (recommended) |

### When to Use Each

**Use `requiredSkills` when:**
- One skill absolutely depends on another's context
- You need guaranteed loading order (foundation → advanced)
- A skill won't make sense without its prerequisite

**Use `affinity` when:**
- Skills complement each other but aren't strict dependencies
- You want to maximize context without burning injection slots
- Related skills should load together for better results

### Real-World Example

**Scenario:** User asks "Help me build a REST API with authentication"

**Configuration:**
```json
{
  "api-development": {
    "type": "domain",
    "affinity": ["api-security"]
  },
  "api-security": {
    "type": "guardrail",
    "requiredSkills": ["security-basics"]
  },
  "security-basics": {
    "type": "domain"
  }
}
```

**What happens:**
1. AI detects `api-development` as critical (confidence > 0.65)
2. System injects `api-development` **(uses 1 slot)**
3. Affinity triggers: `api-security` auto-loads **(FREE - no slot cost)**
4. Dependency resolves: `security-basics` loads first **(FREE - part of
   dependency chain)**

**Result:** **3 skills loaded using only 1 injection slot** 🎉

### Skill Dependencies (requiredSkills)

Use `requiredSkills` for hard dependencies:

```json
{
  "advanced-api-patterns": {
    "requiredSkills": ["api-development", "design-patterns"],
    "type": "domain",
    ...
  }
}
```

**Behavior:**
- Dependencies load **before** the dependent skill
- Uses depth-first search for transitive dependencies
- Detects circular dependencies and reports them
- Example: `advanced-api-patterns` requires `api-development`, which requires
  `http-basics` → Load order: `http-basics` → `api-development` →
  `advanced-api-patterns`

### Skill Affinity

Use `affinity` for complementary skills that work well together:

```json
{
  "frontend-framework": {
    "affinity": ["system-architecture", "api-protocols"],
    "type": "domain",
    ...
  }
}
```

**Rules:**
- **Bidirectional:** If A lists B in affinity, then loading A auto-loads B,
  **AND** loading B auto-loads A
- **Free of slot cost:** Affinity skills don't count toward the 2-skill
  injection limit
- **Max 2 per skill:** Keep affinity lists short for focused context

**Bidirectional Example:**
```json
{
  "frontend-framework": {
    "affinity": ["system-architecture"]
  },
  "api-protocols": {
    "affinity": ["system-architecture"]
  }
}
```

Loading `system-architecture` will automatically load both `frontend-framework`
AND `api-protocols` because they list it in their affinity (reverse affinity).

## Testing Your Skill

### Manual Testing

```bash
cd .claude/hooks

# Test with different prompts
echo '{"session_id":"test","prompt":"your test prompt"}' | \
  npx tsx skill-activation-prompt.ts

# Check output
# Should see skill in "AUTO-LOADED SKILLS" if confidence >0.65
```

### Debug Mode

```bash
export CLAUDE_SKILLS_DEBUG=1
tail -f skill-injection-debug.log

# Run test
echo '{"session_id":"test","prompt":"test"}' | npx tsx skill-activation-prompt.ts

# Check log for confidence scores
```

### Test Checklist

- [ ] Skill activates for primary use cases
- [ ] Doesn't activate for unrelated prompts
- [ ] Content is under 500 lines
- [ ] Examples are working code
- [ ] No TOC/line numbers
- [ ] YAML frontmatter is valid
- [ ] Triggers are specific enough

## Common Mistakes

### ❌ Mistake 1: Too Broad Triggers

```json
"keywords": ["code", "function", "class"]  // Too generic!
```

**Fix:** Be specific to your domain

```json
"keywords": ["database migration", "Alembic", "schema change"]
```

### ❌ Mistake 2: Too Long

```markdown
SKILL.md: 800 lines  // Way too long!
```

**Fix:** Use progressive disclosure

```
SKILL.md: 450 lines (high-level)
resources/patterns.md: 300 lines (details)
```

### ❌ Mistake 3: Abstract Theory

```markdown
Migrations are important for managing database schemas over time.
They allow for versioning and rollback capabilities.
```

**Fix:** Show, don't tell

```python
# Create a migration
alembic revision -m "add users table"

# Run migrations
alembic upgrade head
```

### ❌ Mistake 4: Including TOCs

```markdown
## Table of Contents
- [Purpose](#purpose)
- [Concepts](#concepts)
...
```

**Fix:** Remove TOC, agents don't need it

### ❌ Mistake 5: Overlapping Triggers

```json
"skill-a": {"keywords": ["database"]},
"skill-b": {"keywords": ["database"]}  // Conflict!
```

**Fix:** Use specific, non-overlapping keywords

## Examples

See these skills for reference:

- **python-best-practices** - Well-structured domain skill
- **git-workflow** - Good use of examples and do's/don'ts
- **api-security** - Effective guardrail skill
- **skill-developer** - Domain skill with progressive disclosure

## Next Steps

1. Create your first skill following this guide
2. Test it with real prompts
3. Refine triggers based on results
4. Add more examples and patterns
5. Share your skill with the community

## Getting Help

- Review `skill-developer` skill for comprehensive reference
- Check [ARCHITECTURE.md](ARCHITECTURE.md) for system internals
- Enable debug mode to see confidence scores
- Open an issue if you find bugs

Happy skill authoring!

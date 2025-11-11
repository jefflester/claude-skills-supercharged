# skill-rules.json - Complete Reference

Complete schema and configuration reference for `.claude/skills/skill-rules.json`.

______________________________________________________________________

## File Location

**Path:** `.claude/skills/skill-rules.json`

This JSON file defines all skills and their trigger conditions for the auto-activation system.

______________________________________________________________________

## Complete TypeScript Schema

```typescript
interface SkillRules {
    version: string;
    skills: Record<string, SkillRule>;
}

interface SkillRule {
    type: 'guardrail' | 'domain';
    autoInject?: boolean;
    requiredSkills?: string[];
    description?: string;
    injectionOrder?: number;

    promptTriggers?: {
        keywords?: string[];
    };

    affinity?: string[];  // Bidirectional complementary skills (auto-inject, max 2)
}
```

______________________________________________________________________

## Field Guide

### Top Level

| Field     | Type   | Required | Description                      |
| --------- | ------ | -------- | -------------------------------- |
| `version` | string | Yes      | Schema version (currently "1.0") |
| `skills`  | object | Yes      | Map of skill name → SkillRule    |

### SkillRule Fields

| Field              | Type     | Required | Description                                                |
| ------------------ | -------- | -------- | ---------------------------------------------------------- |
| `type`             | string   | Yes      | "guardrail" (enforced) or "domain" (advisory)              |
| `autoInject`       | boolean  | Optional | Automatically inject this skill when available             |
| `requiredSkills`   | string[] | Optional | Skills that must be injected before this skill             |
| `description`      | string   | Optional | Human-readable description of the skill                    |
| `injectionOrder`   | number   | Optional | Order of injection relative to other skills                |
| `promptTriggers`   | object   | Optional | Triggers based on user prompts                             |
| `affinity`         | string[] | Optional | Complementary skills and bonus injection slots             |

### promptTriggers Fields

| Field      | Type     | Required | Description                                |
| ---------- | -------- | -------- | ------------------------------------------ |
| `keywords` | string[] | Optional | Exact substring matches (case-insensitive) |

### affinity Field

| Field      | Type     | Required | Description                                                     |
| ---------- | -------- | -------- | --------------------------------------------------------------- |
| `affinity` | string[] | Optional | Bidirectional complementary skills (auto-injected, max 2 items) |

**How it works (Bidirectional Auto-Injection):**

- Standard injection limit: 2 skills maximum (critical or promoted)
- Affinity skills auto-inject **bidirectionally** at **no slot cost** (don't count toward 2-skill limit)
- **Direction 1 (Parent→Child):** If skill A is injected and lists `affinity: ["B", "C"]`, both B and C auto-inject
- **Direction 2 (Child→Parent):** If skill A is injected and skill B lists `affinity: ["A"]`, skill B auto-injects
- Affinities respect session state: won't re-inject already-loaded skills
- Max 2 affinities per skill (rare; most have 0-1)

**Example:**

```json
{
  "frontend-framework": {
    "affinity": ["system-architecture", "api-protocols"]
  },
  "api-protocols": {
    "affinity": ["system-architecture"]
  },
  "integration-tools": {
    "affinity": ["system-architecture"]
  },
  "system-architecture": {
    // Root skill - no affinities
  }
}
```

**Scenario:** User asks "Fix the frontend component"

- AI detects: `frontend-framework` (critical)
- System injects: `frontend-framework` (1 critical, counts toward limit)
- Affinity triggers: `system-architecture` + `api-protocols` (2 affinity, free)
- **Total: 3 skills injected** (1 critical + 2 affinity)

______________________________________________________________________

## Example: Guardrail Skill

Complete example of a guardrail skill:

```json
{
  "api-security": {
    "type": "guardrail",
    "description": "Ensures secure API design and implementation",
    "requiredSkills": ["security-basics"],
    "autoInject": true,
    "injectionOrder": 1,

    "promptTriggers": {
      "keywords": [
        "api",
        "endpoint",
        "authentication",
        "authorization",
        "jwt",
        "oauth",
        "password",
        "token",
        "security"
      ]
    },

    "affinity": ["security-basics"]
  }
}
```

### Key Points for Guardrails

1. **type**: Must be "guardrail"
1. **autoInject**: Consider auto-injecting for critical security skills
1. **requiredSkills**: List dependent skills
1. **description**: Clear explanation of the skill's purpose
1. **promptTriggers**: Keywords for detecting relevant prompts
1. **affinity**: Related complementary skills

______________________________________________________________________

## Example: Domain Skill

Complete example of a domain-specific skill:

```json
{
  "python-best-practices": {
    "type": "domain",
    "description": "Python development best practices including PEP 8, type hints, and docstrings",
    "injectionOrder": 2,

    "promptTriggers": {
      "keywords": [
        "python",
        "django",
        "flask",
        "pytest",
        "type hints",
        "docstring",
        "pep 8",
        "refactor",
        "testing"
      ]
    },

    "affinity": []
  }
}
```

### Key Points for Domain Skills

1. **type**: Must be "domain"
1. **description**: Clear explanation of domain expertise
1. **promptTriggers**: Keywords for detecting relevant prompts
1. **requiredSkills**: Dependencies on other skills
1. **affinity**: Related complementary skills

______________________________________________________________________

## Validation

### Check JSON Syntax

```bash
cat .claude/skills/skill-rules.json | jq .
```

If valid, jq will pretty-print the JSON. If invalid, it will show the error.

### Common JSON Errors

**Trailing comma:**

```json
{
  "keywords": ["one", "two",]  // ❌ Trailing comma
}
```

**Missing quotes:**

```json
{
  type: "guardrail"  // ❌ Missing quotes on key
}
```

**Single quotes (invalid JSON):**

```json
{
  'type': 'guardrail'  // ❌ Must use double quotes
}
```

### Validation Checklist

- [ ] JSON syntax valid (use `jq`)
- [ ] All skill names match SKILL.md filenames
- [ ] No duplicate skill names
- [ ] Keywords are meaningful and case-insensitive
- [ ] requiredSkills references exist in the skills map
- [ ] affinity lists reference valid skill names
- [ ] injectionOrder is consistent across skills

______________________________________________________________________

**Related Files:**

- [SKILL.md](../SKILL.md) - Main skill guide
- [trigger-types.md](trigger-types.md) - Complete trigger documentation

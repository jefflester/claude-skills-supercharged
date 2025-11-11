# Claude Code Skills

This directory contains skills that provide comprehensive, context-aware guidance for your project. Skills automatically activate based on your prompts and file edits.

## What Are Skills?

Skills are modular knowledge bases that Claude loads when needed. They provide:

- Domain-specific best practices and patterns
- Code quality guidance and style rules
- Common pitfalls and how to avoid them
- Working code examples and templates
- Security best practices and guardrails

## How Skills Work

The skills system uses an AI-powered hook (`skill-activation-prompt`) that:

1. Analyzes your prompt using Claude Haiku 4.5
2. Assigns confidence scores to each skill (0.0-1.0)
3. Automatically injects high-confidence skills (>0.65)
4. Suggests medium-confidence skills (0.50-0.65)
5. Tracks skills loaded per conversation (no duplicates)
6. Caches analysis results for performance (1-hour TTL)

## Installed Skills

### 1. skill-developer

**Type:** Domain skill
**Purpose:** Explains and maintains the skills system itself

**When it activates:**

- Keywords matching: "Claude Code skill", "skill system", "skill triggers", "skill rules", etc.

**What it covers:**

- Skill structure and YAML frontmatter
- Keyword-based trigger activation
- Hook architecture (UserPromptSubmit workflow)
- The 500-line rule and progressive disclosure
- Skill types (domain and guardrail)
- Automatic injection and session tracking

**Enforcement:** Automatically injected when detected (autoInject: true)

**Main file:** `skill-developer/SKILL.md`
**Resources:** 8 files covering skill creation, triggers, troubleshooting

### 2. python-best-practices (DOMAIN SKILL)

**Type:** Domain skill
**Purpose:** Python development best practices

**When it activates:**

- Keywords matching: "python", "PEP 8", "type hints", "docstring", etc.
- Writing or refactoring Python code

**What it covers:**

- PEP 8 style guidelines
- Type hints and modern Python syntax (3.9+)
- NumPy-style docstrings
- Error handling best practices
- Common patterns (dataclasses, enums, pathlib)
- Testing with pytest

**Main file:** `python-best-practices/SKILL.md` (484 lines)

### 3. git-workflow (DOMAIN SKILL)

**Type:** Domain skill
**Purpose:** Git workflow and version control best practices

**When it activates:**

- Keywords matching: "git", "commit", "branch", "merge", "pull request", etc.

**What it covers:**

- Conventional Commits format
- Branch naming conventions
- Git Flow strategy
- Pull request best practices
- Common Git operations (rebase, stash, cherry-pick)
- Security best practices (signing commits, avoiding secrets)

**Main file:** `git-workflow/SKILL.md` (423 lines)

### 4. api-security (GUARDRAIL SKILL)

**Type:** Guardrail skill (enforces security)
**Purpose:** API security and vulnerability prevention

**When it activates:**

- Keywords matching: "api", "endpoint", "route", "authentication", "security", "SQL injection", "XSS", "CORS", etc.

**What it covers:**

- Authentication and authorization patterns
- Input validation and output sanitization
- SQL injection prevention
- Cross-Site Scripting (XSS) prevention
- HTTPS and transport security
- CORS configuration
- Sensitive data handling
- OWASP Top 10 vulnerabilities

**Main file:** `api-security/SKILL.md` (427 lines)

## How Skills Activate

Skills automatically activate via the `skill-activation-prompt` hook, which uses `skill-rules.json` configuration:

### Trigger Types

Skills are activated based on keywords in prompts:

```json
"promptTriggers": {
  "keywords": ["python", "PEP 8", "type hints"]
}
```

Keywords are matched directly against user prompts for skill activation.

### Skill Types

1. **Domain Skills** - Provide comprehensive guidance for specific areas

   - `type: "domain"`
   - Example: `python-best-practices`, `git-workflow`, `skill-developer`

2. **Guardrail Skills** - Enforce critical best practices

   - `type: "guardrail"`
   - Example: `api-security`


## Configuration

Skills are configured in `skill-rules.json`:

```json
{
  "version": "1.0",
  "skills": {
    "python-best-practices": {
      "type": "domain",
      "autoInject": true,
      "requiredSkills": [],
      "description": "Python development best practices...",
      "promptTriggers": {
        "keywords": ["python", "PEP 8", "type hints"]
      }
    }
  }
}
```

## Adding New Skills

To add a new skill to your project:

1. **Create skill directory:**

   ```bash
   mkdir -p .claude/skills/my-skill/resources
   ```

2. **Create SKILL.md with YAML frontmatter:**

   ```markdown
   ---
   name: my-skill
   description: Brief description of the skill
   ---

   # My Skill

   ## Purpose
   [Explain what this skill does...]

   ## When to Use This Skill
   [When it should activate...]

   [Content under 500 lines...]
   ```

3. **Add to skill-rules.json:**

   ```json
   {
     "my-skill": {
       "type": "domain",
       "autoInject": true,
       "requiredSkills": [],
       "description": "Brief description",
       "promptTriggers": {
         "keywords": ["keyword1", "keyword2"]
       }
     }
   }
   ```

4. **Test activation:**

   ```bash
   # Manual test
   echo '{"session_id":"test","prompt":"mention keywords here"}' | \
     npx tsx .claude/hooks/skill-activation-prompt.ts
   ```

5. **Verify in conversation:**

   - Mention trigger keywords in a prompt
   - Check for skill in "AUTO-LOADED SKILLS" banner

**For detailed guidance**, see `skill-developer/SKILL.md` - the skill that guides the skills system.

## Skill Best Practices

### The 500-Line Rule

**ALL skill markdown files must stay under 500 lines:**

- Target: Under 500 lines
- Warning: Only 5 files maximum can breach 500 lines across entire system
- Hard limit: NO file should EVER breach 600 lines

**Why:** Agents process files linearly. Long files waste tokens and context. Use progressive disclosure instead.

### Progressive Disclosure

Keep main SKILL.md concise, extract details to `resources/`:

```
my-skill/
├── SKILL.md              # < 500 lines, high-level guidance
└── resources/
    ├── patterns.md       # Detailed patterns and practices
    └── examples.md       # Detailed code examples
```

### No TOCs or Line Numbers

**Never include:**

- ❌ Table of Contents (TOC) - Agents don't benefit, just bloat
- ❌ Line number references - Change too frequently
- ❌ Heading navigation links - Agents scan headings natively

### Clear Trigger Keywords

Define specific, non-overlapping keywords that users naturally mention:

- **Keywords**: Exact terms users mention (e.g., "python", "git", "api security")

### Actionable Content

Provide practical, actionable guidance:

- ✅ Working code examples
- ✅ Do's and don'ts
- ✅ Common pitfalls
- ✅ Step-by-step workflows
- ❌ Avoid abstract theory without examples

## Troubleshooting

### Skills not activating

1. **Check trigger configuration in skill-rules.json**

   ```bash
   cat .claude/skills/skill-rules.json
   ```

2. **Test hook manually:**

   ```bash
   echo '{"session_id":"test","prompt":"your test prompt"}' | \
     npx tsx .claude/hooks/skill-activation-prompt.ts
   ```

3. **Enable debug mode:**

   ```bash
   export CLAUDE_SKILLS_DEBUG=1
   ```

4. **Check debug log:**

   ```bash
   tail -f .claude/hooks/skill-injection-debug.log
   ```

### Skills loading but not helping

1. **Check skill content quality** - Is it specific and actionable?
2. **Check file length** - Under 500 lines?
3. **Check examples** - Are there working code examples?
4. **Check structure** - Clear sections with focused guidance?

### Performance issues

1. **Check cache** - Is intent analysis caching working?

   ```bash
   ls -la .cache/intent-analysis/
   ```

2. **Check API key** - Is Anthropic API responding?
3. **Check file sizes** - Are skill files under 500 lines?

### False positives/negatives

1. **Adjust confidence thresholds** in `.claude/hooks/lib/constants.ts`:

   ```typescript
   export const CONFIDENCE_THRESHOLD = 0.65;
   export const SUGGESTED_THRESHOLD = 0.50;
   ```

2. **Refine triggers** in skill-rules.json - More specific keywords for better matching

## Related Documentation

- Hook system: `.claude/hooks/README.md`
- Skill creation guide: `skill-developer/resources/skill-creation-guide.md`
- Architecture documentation: `../docs/ARCHITECTURE.md`
- Getting started: `../docs/GETTING-STARTED.md`
- Main project README: `../README.md`

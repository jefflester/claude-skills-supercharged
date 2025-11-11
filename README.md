# Claude Skills Supercharged

**AI-powered skill auto-injection system for [Claude Code
Skills](https://code.claude.com/docs/en/skills)**

Automatically load domain-specific context into Claude's conversations using AI
intent analysis. No more manually invoking skills or losing context - the system
intelligently detects what you need and injects it automatically.

Credit for the base reference architecture goes to @diet103:

https://github.com/diet103/claude-code-infrastructure-showcase

## Features

- **AI-Powered Intent Analysis**: Claude Haiku 4.5 analyzes your prompts to
  detect relevant skills with 0.0-1.0 confidence scoring
- **Automatic Injection**: High-confidence skills (>0.65) automatically loaded
  into context
- **Smart Caching**: 1-hour TTL reduces API costs (~$1-2/month) and improves
  response time
- **Session Tracking**: Skills only injected once per conversation, no
  duplicates
- **Bidirectional Affinity**: Related skills automatically loaded together
- **Progressive Disclosure**: Main skill files under 500 lines, detailed content
  in resources
- **Guardrail Skills**: Enforce critical best practices (e.g., API security,
  code reuse)
- **Comprehensive Testing**: 11 test files with full coverage of the injection
  pipeline

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/claude-skills-supercharged.git
cd claude-skills-supercharged
```

### 2. Install Dependencies

```bash
cd .claude/hooks
npm install
```

### 3. Configure API Key

```bash
cp .env.example .env
# Edit .env and add: ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get your API key from: https://console.anthropic.com/

### 4. Test the System

```bash
# Test skill activation
echo '{"session_id":"test","prompt":"I need to write Python code"}' | \
  npx tsx skill-activation-prompt.ts
```

### 5. (Optional) Set Up Pre-commit Hooks

```bash
# Install pre-commit
pip install pre-commit  # or: brew install pre-commit

# Install git hooks
pre-commit install

# Run on all files (optional)
pre-commit run --all-files
```

### 6. Use with Claude Code

The system automatically activates when you use Claude Code in this project. Try
these prompts:

- "Help me write a Python function" → Loads `python-best-practices`
- "I need to add a REST API endpoint" → Loads `api-security`
- "How do I write a good commit message?" → Loads `git-workflow`

You'll see a banner showing which skills were loaded:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 AUTO-LOADED SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<skill name="python-best-practices">
[Skill content automatically injected...]
</skill>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## How It Works

The skills system uses a multi-stage pipeline:

```
User Prompt → Intent Analysis (AI/Keywords) → Confidence Scoring (0.0-1.0)
    ↓
Skill Filtration (Apply 2-skill limit) → Affinity Injection (Load related skills)
    ↓
Dependency Resolution (Handle requirements) → Skill Injection (Load SKILL.md files)
    ↓
State Management (Track loaded skills) → Claude receives enriched context
```

### Key Concepts

**Intent Analysis**: Claude Haiku 4.5 analyzes your prompt to determine what
you're trying to do, assigning confidence scores to each skill.

**Confidence Thresholds**:
- **>0.65** - Required (automatically injected)
- **0.50-0.65** - Suggested (shown as optional)
- **<0.50** - Ignored

**Skill Types**:
- **Domain skills**: Provide comprehensive guidance (e.g.,
  `python-best-practices`)
- **Guardrail skills**: Enforce critical practices (e.g., `api-security`)

**Session Tracking**: Skills are tracked per conversation. Once loaded, they
won't be injected again in the same conversation.

**Caching**: Intent analysis results are cached for 1 hour using MD5 hashing of
(prompt + skills config).

## Included Skills

### 1. skill-developer

A domain skill that guides creation and management of the skills system.

**Covers**: Skill structure, triggers, hooks, 500-line rule, progressive
disclosure

### 2. python-best-practices (Domain)

Python development best practices.

**Covers**: PEP 8, type hints, NumPy docstrings, common patterns, testing

### 3. git-workflow (Domain)

Git workflow and version control best practices.

**Covers**: Conventional Commits, branching, PRs, common operations, security

### 4. api-security (Guardrail)

API security and vulnerability prevention. Enforces security checks.

**Covers**: Authentication, input validation, SQL injection, XSS, OWASP Top 10

## Architecture

The system is built on three main components:

1. **Hook System** (`.claude/hooks/`)
   - UserPromptSubmit hook that analyzes prompts
   - 13 TypeScript modules handling the injection pipeline
   - Comprehensive test suite (11 test files)

2. **Skills** (`.claude/skills/`)
   - SKILL.md files with YAML frontmatter
   - Resource directories for detailed content
   - skill-rules.json configuration

3. **Configuration**
   - skill-rules.json: Defines all skills and triggers
   - intent-analysis-prompt.txt: AI analysis template
   - .env: API key configuration

For detailed architecture documentation, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Creating Custom Skills

Creating a new skill is simple:

### 1. Create Skill Directory

```bash
mkdir -p .claude/skills/my-skill/resources
```

### 2. Create SKILL.md

```markdown
---
name: my-skill
description: Brief description of what this skill does
---

# My Skill

## Purpose
What this skill helps with...

## When to Use This Skill
When it should activate...

[Your content here - keep under 500 lines]
```

### 3. Add to skill-rules.json

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

### 4. Test Activation

```bash
echo '{"session_id":"test","prompt":"mention keywords here"}' | \
  npx tsx .claude/hooks/skill-activation-prompt.ts
```

For comprehensive guidance, see
[docs/CREATING-SKILLS.md](docs/CREATING-SKILLS.md) or load the `skill-developer`
skill.

## Configuration

### Adjust Confidence Thresholds

Edit `.claude/hooks/lib/constants.ts`:

```typescript
export const CONFIDENCE_THRESHOLD = 0.65; // Auto-inject
export const SUGGESTED_THRESHOLD = 0.50; // Suggest
export const MAX_REQUIRED_SKILLS = 2; // Max required skills per prompt
export const MAX_SUGGESTED_SKILLS = 2; // Max suggested skills per prompt
```

### Adjust Cache TTL

```typescript
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
```

### Enable Debug Mode

```bash
export CLAUDE_SKILLS_DEBUG=1
tail -f .claude/hooks/skill-injection-debug.log
```

## Testing

Run the comprehensive test suite:

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

## Performance

- **Intent Analysis**: ~200ms (first call), <10ms (cached)
- **Cost**: ~$1-2/month at 100 prompts/day (Claude Haiku)
- **Cache Hit Rate**: ~60-80% after initial prompts
- **False Positive Reduction**: ~30% → <5% with AI analysis

## Troubleshooting

### Skills not activating

```bash
# Check configuration
cat .claude/skills/skill-rules.json

# Test manually
echo '{"session_id":"test","prompt":"python"}' | \
  npx tsx .claude/hooks/skill-activation-prompt.ts

# Enable debug mode
export CLAUDE_SKILLS_DEBUG=1

# Check debug log
tail -f .claude/hooks/skill-injection-debug.log
```

### API key issues

```bash
# Verify .env file
cat .claude/hooks/.env

# Test API key
curl -H "x-api-key: $ANTHROPIC_API_KEY" \
  https://api.anthropic.com/v1/messages
```

### Clear caches

```bash
# Clear intent analysis cache
rm -rf .cache/intent-analysis/

# Clear session state
rm -rf .claude/hooks/state/
```

## Documentation

- [Getting Started Guide](docs/GETTING-STARTED.md) - Step-by-step setup
- [Architecture Documentation](docs/ARCHITECTURE.md) - System design and
  internals
- [Creating Skills Guide](docs/CREATING-SKILLS.md) - How to author custom skills
- [Hooks README](.claude/hooks/README.md) - Hook system documentation
- [Skills README](.claude/skills/README.md) - Skills system overview

## Contributing

Contributions welcome! This is a template/framework for building skills systems.
Feel free to:

- Add new example skills
- Improve documentation
- Enhance the intent analysis prompt
- Add new features to the hook system
- Report bugs or suggest improvements

## License

MIT License - See [LICENSE](LICENSE) for details.

## Credits

Built for the Claude Code community. Inspired by the need for automatic,
intelligent context loading in AI-assisted development workflows.

## FAQ

**Q: Does this work with other AI assistants?** A: The skills system is specific
to Claude Code's hook system. However, the concept can be adapted to other
tools.

**Q: How much does the API usage cost?** A: Approximately $1-2/month at 100
prompts/day using Claude Haiku 4.5. Caching significantly reduces costs.

**Q: Can I use this without the AI analysis?** A: Yes! Set `ANTHROPIC_API_KEY`
to empty and the system will fall back to keyword matching.

**Q: How do I disable a skill?** A: Set `autoInject: false` in skill-rules.json
or remove the skill entirely.

**Q: What's the 500-line rule?** A: Skills should stay under 500 lines for
optimal agent processing. Use progressive disclosure (resource files) for
detailed content.

**Q: Can skills depend on other skills?** A: Yes! Use the `requiredSkills` array
in skill-rules.json to specify dependencies.

**Q: How do I see which skills are loaded?** A: Look for the "📚 AUTO-LOADED
SKILLS" banner at the start of Claude's response.

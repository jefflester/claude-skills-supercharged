# Getting Started with Claude Skills Supercharged

This guide walks you through setting up and using the Claude Skills Supercharged system in your project.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- Node.js 18+ and npm
- An Anthropic API key ([get one here](https://console.anthropic.com/))

## Installation

### Step 1: Get the Code

You have two options:

**Option A: Use as a template** (recommended for new projects)

```bash
# Clone this repository as a template for your project
git clone https://github.com/jefflester/claude-skills-supercharged.git my-project
cd my-project
rm -rf .git  # Remove template git history
git init     # Start fresh
```

**Option B: Copy into existing project**

```bash
# Copy the .claude directory into your project
cp -r claude-skills-supercharged/.claude /path/to/your/project/
cd /path/to/your/project
```

### Step 2: Install Dependencies

```bash
cd .claude/hooks
npm install
```

This installs:
- `@anthropic-ai/sdk` - For AI-powered intent analysis
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution
- `@types/node` - Node.js type definitions
- `vitest` - Testing framework

### Step 3: Configure API Key

```bash
# Create .env file from template
cp .env.example .env

# Edit .env and add your API key
echo 'ANTHROPIC_API_KEY=sk-ant-your-key-here' > .env
```

**Get your API key:**
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Copy the key (starts with `sk-ant-`)

### Step 4: Test the Installation

```bash
# Test that the hook system works
echo '{"session_id":"test","prompt":"help me write python code"}' | \
  npx tsx skill-activation-prompt.ts
```

**Expected output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 AUTO-LOADED SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<skill name="python-best-practices">
...
</skill>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 5: Run Tests (Optional but Recommended)

```bash
# Run the full test suite
npm test

# Run specific test file
npm test -- intent-analyzer.test.ts

# Run with coverage
npm test -- --coverage
```

## Using the System

### Basic Usage

Once installed, the skills system activates automatically when you use Claude Code in your project. No manual invocation needed!

**Try these prompts:**

1. **Python development:**
   ```
   "Help me write a Python function to parse JSON"
   ```
   → Automatically loads `python-best-practices`

2. **API development:**
   ```
   "I need to add a new REST API endpoint"
   ```
   → Automatically loads `api-security`

3. **Git operations:**
   ```
   "How do I write a good commit message?"
   ```
   → Automatically loads `git-workflow`

### What You'll See

When a skill activates, you'll see a banner:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 AUTO-LOADED SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ JUST LOADED:
  • python-best-practices (confidence: 0.85)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Understanding Skill Activation

**Confidence Levels:**
- **> 0.65** - Relevant, loaded automatically
- **0.50-0.65** - Possibly relevant, suggested
- **< 0.50** - Not relevant, ignored

**Session Tracking:**
- Skills load once per conversation
- Subsequent prompts in same conversation don't re-inject
- Start a new conversation to reset

## Customizing for Your Project

### Add Project-Specific Skills

Create skills tailored to your project:

1. **Create skill directory:**
   ```bash
   mkdir -p .claude/skills/my-project-patterns
   ```

2. **Create SKILL.md:**
   ```markdown
   ---
   name: my-project-patterns
   description: Patterns specific to my project
   ---

   # My Project Patterns

   ## Purpose
   Provide guidance on architecture patterns used in this project.

   ## When to Use This Skill
   - Working with project-specific modules
   - Following project conventions
   ...
   ```

3. **Add to skill-rules.json:**
   ```json
   {
     "my-project-patterns": {
       "type": "domain",
       "autoInject": true,
       "requiredSkills": [],
       "description": "Project-specific patterns and conventions",
       "promptTriggers": {
         "keywords": ["project pattern", "project convention", "architecture", "codebase structure"]
       }
     }
   }
   ```

### Adjust Skill Behavior

**Change confidence thresholds:**

Edit `.claude/hooks/lib/constants.ts`:

```typescript
// Lower threshold = more aggressive activation
export const CONFIDENCE_THRESHOLD = 0.60; // Default: 0.65

// Raise threshold = more selective suggestions
export const SUGGESTED_THRESHOLD = 0.55; // Default: 0.50
```

**Change injection limits:**

```typescript
// Allow more required skills per prompt
export const MAX_REQUIRED_SKILLS = 3; // Default: 2

// Allow more suggested skills per prompt
export const MAX_SUGGESTED_SKILLS = 3; // Default: 2
```

**Disable specific skills:**

In `skill-rules.json`, set `autoInject: false`:

```json
{
  "git-workflow": {
    "autoInject": false,  // Skill won't auto-inject
    ...
  }
}
```

### Enable Debug Mode

See exactly what the system is doing:

```bash
# Enable debug logging
export CLAUDE_SKILLS_DEBUG=1

# View debug log in real-time
tail -f .claude/hooks/skill-injection-debug.log
```

**Debug log includes:**
- Prompt analysis results
- Confidence scores per skill
- Filtration decisions
- Affinity injections
- Cache hits/misses

## Common Workflows

### Workflow 1: First Time Using Claude in Project

1. Open Claude Code in your project
2. Type a prompt related to your work
3. See skills auto-inject based on your prompt
4. Claude responds with enhanced context
5. Continue conversation - skills stay loaded

### Workflow 2: Adding New Code

1. "Help me add authentication to my API"
2. `api-security` skill auto-loads
3. Claude provides security-focused guidance
4. Implement with proper auth, validation, etc.
5. Security best practices enforced automatically

### Workflow 3: Code Review

1. "Review this Python code for issues"
2. `python-best-practices` auto-loads
3. Claude checks PEP 8, type hints, docstrings
4. Provides specific, actionable feedback
5. Maintains project coding standards

### Workflow 4: Working with Git

1. "Help me write a commit message"
2. `git-workflow` auto-loads
3. Claude suggests Conventional Commits format
4. Provides guidance on what to include
5. Ensures consistent commit history

## Troubleshooting Common Issues

### Issue: Skills not activating

**Symptoms:** No "AUTO-LOADED SKILLS" banner appears

**Solutions:**

1. **Test manually:**
   ```bash
   cd .claude/hooks
   echo '{"session_id":"test","prompt":"python"}' | npx tsx skill-activation-prompt.ts
   ```

2. **Check API key:**
   ```bash
   cat .claude/hooks/.env | grep ANTHROPIC_API_KEY
   ```

3. **Enable debug mode:**
   ```bash
   export CLAUDE_SKILLS_DEBUG=1
   tail -f .claude/hooks/skill-injection-debug.log
   ```

### Issue: Wrong skills activating

**Symptoms:** Skills load that don't seem relevant

**Solutions:**

1. **Check triggers in skill-rules.json:**
   - Are keywords too broad?
   - Consider making keywords more specific

2. **Adjust confidence thresholds:**
   - Raise `CONFIDENCE_THRESHOLD` to 0.70+ in `.claude/hooks/lib/constants.ts`
   - This makes activation more selective

3. **Add negative examples to intent prompt:**
   - Edit `.claude/hooks/config/intent-analysis-prompt.txt`
   - Add examples of when NOT to activate

### Issue: Performance is slow

**Symptoms:** Noticeable delay before Claude responds

**Solutions:**

1. **Check cache is working:**
   ```bash
   ls -la .cache/intent-analysis/
   ```
   Should see cached analysis files (cache is stored at project root)

2. **Verify cache TTL:**
   ```typescript
   // In lib/constants.ts
   export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
   ```

3. **Check skill file sizes:**
   ```bash
   wc -l .claude/skills/*/SKILL.md
   ```
   All should be under 500 lines

### Issue: API costs too high

**Symptoms:** Anthropic bill higher than expected

**Solutions:**

1. **Check cache hit rate:**
   - Enable debug mode
   - Look for "cache hit" vs "cache miss" in logs

2. **Increase cache TTL:**
   ```typescript
   export const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
   ```

3. **Use keyword fallback:**
   ```bash
   # Remove API key to force keyword matching
   cd .claude/hooks
   mv .env .env.backup
   ```

4. **Reduce injection limits:**
   ```typescript
   export const MAX_REQUIRED_SKILLS = 1; // Only most confident
   export const MAX_SUGGESTED_SKILLS = 1;
   ```

## Next Steps

Now that you're set up:

1. **Read the example skills** to understand the format and style
2. **Create your first custom skill** for your project
3. **Explore the architecture** in [ARCHITECTURE.md](ARCHITECTURE.md)
4. **Learn skill authoring** in [CREATING-SKILLS.md](CREATING-SKILLS.md)
5. **Contribute improvements** back to the project

## Getting Help

- **Check the FAQ** in main README.md
- **Review skill-developer skill** - Learn about the skill system
- **Enable debug mode** - See exactly what's happening
- **Open an issue** - Report bugs or request features on GitHub

## What's Next?

- [ARCHITECTURE.md](ARCHITECTURE.md) - Understanding the system internals
- [CREATING-SKILLS.md](CREATING-SKILLS.md) - Authoring effective skills
- [skill-developer/SKILL.md](../.claude/skills/skill-developer/SKILL.md) - Skill system reference

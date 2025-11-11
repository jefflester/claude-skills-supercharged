# Trigger Types - Complete Guide

Complete reference for configuring skill triggers in Claude Code's skill auto-activation system.

______________________________________________________________________

## Keyword Triggers (Explicit)

### How It Works

Case-insensitive substring matching in user's prompt.

### Use For

Topic-based activation where user explicitly mentions the subject.

### Configuration

```json
"promptTriggers": {
  "keywords": ["layout", "grid", "toolbar", "submission"]
}
```

### Example

- User prompt: "how does the **layout** system work?"
- Matches: "layout" keyword
- Activates: `project-catalog-developer`

### Best Practices

- Use specific, unambiguous terms
- Include common variations ("layout", "layout system", "grid layout")
- Avoid overly generic words ("system", "work", "create")
- Test with real prompts

______________________________________________________________________

______________________________________________________________________

File path and content triggers are not yet implemented.

______________________________________________________________________

## Best Practices Summary

### DO:

✅ Use specific, unambiguous keywords
✅ Test all patterns with real examples
✅ Include common variations

### DON'T:

❌ Use overly generic keywords ("system", "work")

### Testing Your Triggers

**Test keyword triggers:**

```bash
echo '{"session_id":"test","prompt":"your test prompt"}' | \
  npx tsx .claude/hooks/skill-activation-prompt.ts
```

______________________________________________________________________

**Related Files:**

- [SKILL.md](../SKILL.md) - Main skill guide
- [skill-rules-reference.md](skill-rules-reference.md) - Complete skill-rules.json schema
- [patterns-library.md](patterns-library.md) - Ready-to-use pattern library

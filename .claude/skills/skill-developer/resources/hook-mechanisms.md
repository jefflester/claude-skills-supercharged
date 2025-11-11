# Hook Mechanisms - Deep Dive

Technical deep dive into how the UserPromptSubmit hook works.

______________________________________________________________________

## UserPromptSubmit Hook Flow

### Execution Sequence

```
User submits prompt
    ↓
skill-activation-prompt.sh executes
    ↓
npx tsx skill-activation-prompt.ts
    ↓
Hook reads stdin (JSON with prompt)
    ↓
Loads skill-rules.json
    ↓
Matches keywords + intent patterns
    ↓
Groups matches by priority (critical → high → medium → low)
    ↓
Outputs formatted message to stdout
    ↓
stdout becomes context for Claude (injected before prompt)
    ↓
Claude sees: [skill suggestion] + user's prompt
```

### Key Points

- **Exit code**: Always 0 (allow)
- **stdout**: → Claude's context (injected as system message)
- **Timing**: Runs BEFORE Claude processes prompt
- **Behavior**: Non-blocking, advisory only
- **Purpose**: Make Claude aware of relevant skills

### Input Format

```json
{
  "session_id": "abc-123",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/root/git/your-project",
  "permission_mode": "normal",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "how does the layout system work?"
}
```

### Output Format (to stdout)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 SKILL ACTIVATION CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 RECOMMENDED SKILLS:
  → project-catalog-developer

ACTION: Use Skill tool BEFORE responding
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Claude sees this output as additional context before processing the user's prompt.

______________________________________________________________________

## Performance Considerations

### Target Metrics

- **UserPromptSubmit**: < 100ms

### Performance Bottlenecks

1. **Loading skill-rules.json** (every execution)

   - Future: Cache in memory
   - Future: Watch for changes, reload only when needed

1. **Regex matching** (UserPromptSubmit)

   - Intent patterns matching
   - Future: Lazy compile, cache compiled regexes

### Optimization Strategies

**Reduce patterns:**

- Use more specific patterns (fewer to check)
- Combine similar patterns where possible

______________________________________________________________________

**Related Files:**

- [SKILL.md](../SKILL.md) - Main skill guide
- [skill-rules-reference.md](skill-rules-reference.md) - Configuration reference

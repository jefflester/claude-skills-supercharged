# OpenCode Dynamic Skills Injector

Plugin port of `claude-skills-supercharged` for the OpenCode runtime.

## Overview

Automatically selects and injects relevant skills based on user prompts.
Supports three integration modes:
1. **OpenCode Plugin Hook** — `experimental.chat.system.transform`
2. **CLI Interface** — standalone skill selector
3. **MCP Server** — Model Context Protocol tool

## Installation

1. **Build the plugin:**
   ```bash
   npm install
   npm run build
   ```

2. **Register in OpenCode**:
   Add to your `opencode.json`:
   ```json
   {
     "plugin": [
       "file:///D:/AI/OpenCode/runtime/config/opencode/plugins/dynamic-skills-injector.js"
     ]
   }
   ```

3. **Create the plugin wrapper**:
   `D:\AI\OpenCode\runtime\config\opencode\plugins\dynamic-skills-injector.js`:
   ```javascript
   import plugin from "file:///D:/AI/Plugins/dynamicskillsinjector/opencode/dist/hooks/index.js";
   export const DynamicSkillsInjector = plugin;
   ```

## Configuration

Set via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCODE_PROJECT_DIR` | Path to project containing `.claude/skills/` | `process.cwd()` |
| `OPENCODE_SKILLS_DEBUG` | Enable debug logging (`1` to enable) | `0` |
| `OPENCODE_SKILLS_PROVIDER` | AI provider: `anthropic`, `openai`, `ollama` | `anthropic` |
| `OPENCODE_SKILLS_MODEL` | Model override | Provider-specific |
| `ANTHROPIC_API_KEY` | Anthropic API key | Optional when Anthropic is configured in OpenCode auth |
| `OPENAI_API_KEY` | OpenAI API key | Required for OpenAI |
| `OLLAMA_BASE_URL` | Ollama endpoint | `http://localhost:11434` |
| `OPENCODE_AUTH_PATH` | Explicit OpenCode auth store path for API credentials | Auto-discovered from OpenCode data dir |

### Thresholds

| Variable | Description | Default |
|----------|-------------|---------|
| `SKILL_CONFIDENCE_THRESHOLD` | Min confidence for required skills | `0.65` |
| `SKILL_SUGGESTED_THRESHOLD` | Min confidence for suggestions | `0.50` |
| `SKILL_SHORT_PROMPT_WORDS` | Word count for keyword fallback; AI analysis starts at 6+ words | `5` |
| `SKILL_CACHE_TTL_MS` | Cache time-to-live | `1 hour` |

## Usage

### CLI

```bash
# Set project directory and run
$env:OPENCODE_PROJECT_DIR = "D:\AI\Plugins\dynamicskillsinjector"
npx tsx src/cli.ts "Help me write a secure API endpoint" --debug
```

Options:
- `--sessionId <id>` — Session ID for duplicate prevention
- `--threshold <n>` — Override confidence threshold
- `--provider <name>` — Override AI provider
- `--debug` — Enable debug output
- `--format json` — JSON output

### MCP Server

```bash
npx tsx src/mcp-server.ts
```

Exposes the `select_skills` tool via Model Context Protocol.

## Architecture

### Three-Hook OpenCode Plugin

1. **`event: session.created`** — Initializes session state
2. **`chat.message`** — Analyzes prompt intent
3. **`experimental.chat.system.transform`** — Injects selected skills

### Pipeline

```
User Prompt → Intent Analysis → Skill Scoring → Filtration →
Dependency Resolution → Affinity Injection → Format Output →
System Context Injection
```

**Fallback:** If no API key, keyword matching activates for guardrail skills.

## Testing

```bash
npm run test          # Run all tests
npm run test:coverage # Run with coverage report
npm run check         # TypeScript typecheck
```

Current coverage: **38.28% package-wide statements, 37.68% package-wide lines**. The hook library is covered at **80.33% statements, 81.29% lines**; package-wide coverage is lower because the CLI and MCP server entrypoints are mostly uncovered.

## Limitations vs Claude Code

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| Hook system | `UserPromptSubmit` | `experimental.chat.system.transform` |
| Config path | `.claude/settings.json` | `opencode.json` (JSON5) |
| Skill directory | `.claude/skills/` | Same (uses `.claude/skills/`) |
| Event format | Custom JSON | OpenCode SDK types |

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| `ENOENT: .claude/skills/skill-rules.json` | Set `OPENCODE_PROJECT_DIR` to parent of `.claude` |
| `Missing API key` | Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` |
| `Debug logging failed` | Create `.opencode/hooks/` directory |
| Plugin not loaded | Verify `opencode.json` plugin array includes wrapper path |

## License

MIT — See `../LICENSE` for details.

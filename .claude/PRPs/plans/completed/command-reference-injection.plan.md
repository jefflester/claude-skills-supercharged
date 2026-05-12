# Plan: Command Reference Injection

## Summary
Extend the OpenCode Dynamic Skills Injector so it can discover OpenCode commands, score them alongside skills, inject high-confidence command references, and separately recommend suggested command references. Mandatory command reference injection should require confidence >= 0.90; suggested commands should cover 0.70 through 0.89. The feature must use OpenCode's real command surfaces: config `command` entries plus markdown command files, not dynamic slash-command registration.

## User Story
As an OpenCode user, I want the injector to include highly relevant command instructions automatically and recommend nearby commands, so that OpenCode sessions get the same workflow guidance from commands that they already get from skills.

## Problem -> Solution
Current runtime analyzes and injects only skills. OpenCode commands are available in the runtime config and command markdown directories, but the injector does not discover, score, recommend, or track them. Add a command discovery and reference-injection path that mirrors the existing skill recommendation pattern while using higher thresholds and command-specific safety rules.

## Metadata
- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: standalone
- **Estimated Files**: 12-16
- **Branch**: `codex/command-body-injection-prp`
- **Baseline Commit**: `1b065d6`

---

## Workspace Surface Audit

### Current Surface
- Repo root: `D:\AI\Plugins\dynamicskillsinjector`
- Runtime package: `opencode/`
- Active OpenCode config: `D:\AI\OpenCode\runtime\config\opencode\opencode.json`
- Active command markdown directory: `D:\AI\OpenCode\runtime\config\opencode\commands`
- Global OpenCode command source: `D:\AI\GlobalRepo\commands\opencode`
- ECC command parity check: `D:\AI\GlobalRepo\commands\opencode\ecc` has 72 `.md` commands and `D:\AI\OpenCode\runtime\config\opencode\commands` has the same 72 command names. Missing from runtime: 0. Extra in runtime: 0.
- Other global command folders: `D:\AI\GlobalRepo\commands\opencode\local` has 1 command; `D:\AI\GlobalRepo\commands\opencode\flock` currently has 0 markdown commands.
- Active command registry: `opencode.json` contains a top-level `command` object.
- Active plugin list currently includes `dynamic-skills-injector.js` and does not list `open-agent-skills.js`.

### ECC Skills To Use
- `prp-plan`: implementation-ready PRP artifact creation.
- `workspace-surface-audit`: confirm command, plugin, repo, and config surfaces before implementation.
- `team-builder`: select the relevant ECC specialist lanes.
- `model-route`: route specialist lanes by complexity and risk using Codex models only.
- `tdd-workflow`: write tests before implementation.
- `verification-loop`: run check, tests, build, and live OpenCode verification.
- `code-review`: review final diff.
- `security-review`: review command reference injection risks.
- `build-fix`: only if build or typecheck fails.
- `docs-lookup`: verify current OpenCode docs for command/config/plugin behavior.
- `documentation-lookup`: verify current external docs if `docs-lookup` is unavailable.
- `refactor-clean`: use after implementation to check for unnecessary duplication or dead code.
- `performance-optimizer`: use for command discovery/cache/context-size performance review.
- `plankton-code-quality`: required local code quality pass before final review.
- `quality-gate`: required ECC quality pipeline pass for the affected scope.
- `update-docs`: only if README/docs become inaccurate.

### ECC Commands To Use During Implementation
Use these slash-command workflows explicitly in the implementation run where available:

| Stage | Commands / Skills |
|---|---|
| Planning and surface proof | `/plan`, `/workspace-surface-audit`, `/team-builder`, `/model-route`, `/prp-plan` |
| Documentation verification | `/docs-lookup`, `/documentation-lookup` |
| Test-first implementation | `/tdd-workflow`, `/build-fix` if check/build fails |
| Quality cleanup | `/refactor-clean`, `/performance-optimizer`, required `/plankton-code-quality`, required `/quality-gate` |
| Final verification | required `/plankton-code-quality`, required `/quality-gate`, `/verification-loop`, `/code-review`, `/security-review`, `/update-docs` only if docs changed |

### Relevant ECC Sub-Agents
Use these lanes when implementing this plan. The user requested this wider agent set; determine at each stage which lanes are actually applicable. Codex may not be able to force every sub-agent onto the requested model because some agent roles have fixed defaults. Do not stop if routing falls back to each agent's configured default; record the fallback in the final report.

Codex-only model routing:
- Highest complexity architecture/planning: `GPT-5.5`.
- Normal implementation and refactor judgment: `gpt-5.4`.
- Focused review/test lanes: `GPT-5.4-mini` with high reasoning, or each fixed reviewer default.
- Build/type repair and coding lane: `gpt-5.3-codex`.
- Fast mechanical checks or low-risk lookups: `GPT-5.3-Codex-Spark`.

Do not use Claude/Anthropic model names for agent routing recommendations in this plan.

| Agent | Role In This Feature | Codex Model Route |
|---|---|---|
| `planner` | Keep implementation sequenced and scope controlled | `GPT-5.5`; fixed role default is acceptable |
| `code-architect` | Design the command discovery/scoring contract and data flow | `gpt-5.4` or fixed role default |
| `build-error-resolver` | Primary coding/build-fix lane requested by user; apply code changes and resolve type/build failures | `gpt-5.3-codex`; fixed role default is acceptable |
| `tdd-guide` | Drive tests first for discovery, scoring, formatting, state, and hook behavior | `gpt-5.4` or fixed role default |
| `typescript-reviewer` | Review TS type safety, async behavior, and module boundaries | `GPT-5.4-mini` high or fixed role default |
| `security-reviewer` | Check command reference injection, path discovery, and no shell execution | `gpt-5.4` or fixed role default |
| `silent-failure-hunter` | Review for swallowed errors, quiet fallback paths, and missing debug evidence | `GPT-5.4-mini` high or fixed role default |
| `refactor-cleaner` | Check whether command discovery/scoring adds unnecessary duplication or dead code | `GPT-5.4-mini` high or fixed role default |
| `performance-optimizer` | Check command discovery, cache key size, prompt preview size, and context overhead | `GPT-5.4-mini` high or fixed role default |
| `code-simplifier` | Simplify implementation after tests pass without changing behavior | `GPT-5.4-mini` high or fixed role default |
| `doc-updater` | Update README/docs only if behavior or env vars changed | `gpt-5.3-codex` fixed role default |
| `python-reviewer` | Use only if Python code or Python test harness code is touched | `GPT-5.4-mini` high or fixed role default |
| `docs_researcher` | Verify OpenCode command/plugin docs and release-note-sensitive behavior | `gpt-5.4` or fixed role default |
| `docs-lookup` | Fetch current docs/API examples if available in the environment | `gpt-5.3-codex` fixed role default |
| `explorer` | Read-only inspection before implementation or when behavior is unclear | `gpt-5.3-codex` fixed role default |
| `code-explorer` | Trace existing code paths when a deeper source map is needed | `gpt-5.3-codex` fixed role default |

---

## UX Design

### Before
Internal change. The system transform hook can inject skills and show recommended skills, but commands are invisible to the injector.

### After
Internal change. The transform hook can add:
- A command activation summary.
- Mandatory command references for commands with confidence >= 0.90, formatted as `/command-name`.
- A suggested commands section for commands with confidence 0.70-0.89, also formatted as `/command-name`.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Prompt analysis | Skills only | Skills plus commands | One AI analysis call should return both where possible. |
| System context | Skill XML only | Skill XML plus command-reference guidance | Commands are inserted as names, not full templates. |
| Summary banner | Skill activation check | Skill and command activation check | Keep readable and concise. |
| Duplicate prevention | Tracks acknowledged skills | Tracks acknowledged skills and commands | Backwards compatible state read. |
| MCP/CLI | `select_skills` only | Either expanded result or new command-aware tool | Preserve existing tool compatibility. |

---

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| OpenCode commands | https://opencode.ai/docs/commands/ | Commands are custom prompt templates exposed through `opencode.json` `command` entries or markdown files in command directories. |
| Command templates | https://opencode.ai/docs/commands/ | Markdown command body becomes the template; config command `template` is required. |
| Command placeholders | https://opencode.ai/docs/commands/ | Commands may contain `$ARGUMENTS`, positional args, shell-output placeholders, and file references. Do not inject or expand command bodies by default. |
| OpenCode plugins | https://opencode.ai/docs/plugins/ | Plugins hook events; command events exist, but they are not the command-definition mechanism. |
| OpenCode plugin load order | https://opencode.ai/docs/plugins/ | Global and project config/plugins can both load; discovery should honor explicit runtime paths and avoid deleting or modifying config. |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\index.ts` | 212-392 | Main OpenCode hook flow, session state, skill analysis, summary, and injection. |
| P0 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\types.ts` | 8-79 | Shared analysis, skill, session, and cache contracts to extend. |
| P0 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\intent-analyzer.ts` | 161-241 | AI/keyword/cache orchestration for prompt analysis. |
| P0 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\intent-scorer.ts` | 25-103 | Threshold classification and score-map pattern. |
| P0 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\output-formatter.ts` | 23-153 | Existing injection and recommendation formatting pattern. |
| P0 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\skill-state-manager.ts` | 32-95 | Atomic state write and duplicate prevention pattern. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\skill-discovery.ts` | 28-199 | Discovery/frontmatter pattern to mirror for command markdown files. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\skill-filtration.ts` | 47-203 | Filtering, promotion, and remaining-suggested pattern. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\config\intent-analysis-prompt.txt` | 1-80 | Current AI prompt format to extend for commands. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\cache-manager.ts` | 31-75 | Cache key/result pattern that must include command configuration. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\src\cli.ts` | 302-320 | CLI selection flow mirrors runtime selection. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\src\mcp-server.ts` | 271-368, 471-488 | MCP `select_skills` tool and result shape. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\__tests__\scoring-filtration.test.ts` | 140-294 | Existing scoring, filtration, and formatting tests. |
| P1 | `D:\AI\Plugins\dynamicskillsinjector\opencode\hooks\lib\__tests__\skill-discovery.test.ts` | 5-237 | Discovery/frontmatter test style. |
| P2 | `D:\AI\OpenCode\runtime\config\opencode\opencode.json` | 9-13, 60+ | Active plugin list and config command registry. Read only unless separately authorized. |
| P2 | `D:\AI\OpenCode\runtime\config\opencode\commands\prp-plan.md` | 1-60 | Example markdown command with frontmatter and body. |

---

## Patterns To Mirror

### NAMING_CONVENTION
// SOURCE: `opencode/hooks/lib/skill-discovery.ts:151-199`
Use small noun-based modules under `opencode/hooks/lib/`: `skill-discovery.ts`, `skill-filtration.ts`, `output-formatter.ts`. Add command equivalents such as `command-discovery.ts`, `command-filtration.ts`, and command formatting functions in `output-formatter.ts` or a focused `command-output-formatter.ts`.

### ERROR_HANDLING
// SOURCE: `opencode/hooks/index.ts:120-146`, `opencode/hooks/lib/skill-discovery.ts:175-180`
Discovery failures should not break the hook. Log through `debugLog` where appropriate and fall back to an empty command registry or discovered subset.

### LOGGING_PATTERN
// SOURCE: `opencode/hooks/index.ts:299-345`
Use compact debug lines with session id and selected names. Do not print command bodies or secrets in logs. Log selected/recommended command names only.

### STATE_PATTERN
// SOURCE: `opencode/hooks/lib/skill-state-manager.ts:32-95`
Use atomic writes and backwards-compatible state reads. Existing state files with only `acknowledgedSkills` must still parse.

### SCORING_PATTERN
// SOURCE: `opencode/hooks/lib/intent-scorer.ts:25-43`
Categorize by thresholds, sort by confidence descending, cap results, and return arrays plus optional score maps.

### INJECTION_PATTERN
// SOURCE: `opencode/hooks/lib/output-formatter.ts:23-56`
Read files synchronously during formatting only after final selection, wrap injected content in explicit XML-like tags, and return an empty string when no content is injected.

### TEST_STRUCTURE
// SOURCE: `opencode/hooks/lib/__tests__/scoring-filtration.test.ts:140-294`
Use Vitest unit tests with small inline fixtures and direct function assertions before hook-level integration tests.

---

## Files To Change

| File | Action | Justification |
|---|---|---|
| `opencode/hooks/lib/types.ts` | UPDATE | Add command rule, command confidence, command analysis, command state, and cache types. |
| `opencode/hooks/lib/constants.ts` | UPDATE | Add command thresholds and caps: required >= 0.90, suggested >= 0.70 and < 0.90. |
| `opencode/hooks/lib/command-discovery.ts` | CREATE | Discover command metadata and bodies from config `command` object and markdown command directories. |
| `opencode/hooks/lib/command-filtration.ts` | CREATE | Filter acknowledged commands and enforce command injection/suggestion caps without skill promotion semantics. |
| `opencode/hooks/lib/intent-scorer.ts` | UPDATE | Add command categorization while preserving existing skill scoring behavior. |
| `opencode/hooks/lib/intent-analyzer.ts` | UPDATE | Pass candidate commands into AI analysis and include command config in cache key. |
| `opencode/hooks/lib/ai-client.ts` | UPDATE | Extend prompt building and response parsing to include command scores. |
| `opencode/hooks/config/intent-analysis-prompt.txt` | UPDATE | Ask model to score both skills and commands with separate thresholds. |
| `opencode/hooks/lib/output-formatter.ts` | UPDATE | Add command summary, mandatory command-reference section, and suggested command-reference section. |
| `opencode/hooks/lib/skill-state-manager.ts` | UPDATE | Read/write acknowledged commands in addition to acknowledged skills. |
| `opencode/hooks/index.ts` | UPDATE | Wire command discovery, analysis, duplicate prevention, summary, and injection into `experimental.chat.system.transform`. |
| `opencode/src/cli.ts` | UPDATE | Expose command recommendations/injections in JSON/text output or explicitly document CLI remains skills-only. Preferred: include commands. |
| `opencode/src/mcp-server.ts` | UPDATE | Preserve `select_skills`; add command fields to structured output or add `select_context` tool. |
| `opencode/hooks/lib/__tests__/command-discovery.test.ts` | CREATE | Test config commands, markdown commands, frontmatter parsing, and precedence. |
| `opencode/hooks/lib/__tests__/command-scoring-filtration.test.ts` | CREATE | Test 0.90+ injection and 0.70-0.89 suggestions. |
| `opencode/hooks/lib/__tests__/command-output-formatter.test.ts` | CREATE/UPDATE | Test command-reference formatting and prove command bodies are not injected. |
| `opencode/README.md` | UPDATE IF NEEDED | Document command injection env vars and safety semantics. |

## NOT Building

- No dynamic slash-command registration.
- No command execution.
- No full command-body injection by default.
- No expansion of `!` shell placeholders, `@file` references, `$ARGUMENTS`, or positional placeholders.
- No edits to `D:\AI\OpenCode\runtime\config\opencode\opencode.json` unless separately authorized.
- No deletion of command files or plugin files.
- No changes to Swarm config.
- No changes to skill thresholds unless strictly required for shared type shape.

---

## Step-By-Step Tasks

### Task 1: Add Command Types And Constants
- **ACTION**: Extend shared types and constants.
- **IMPLEMENT**: Add `CommandRule`, `CommandRulesConfig`, `CommandConfidence`, command fields on `IntentAnalysis` and `AnalysisResult`, and session/cache support for commands.
- **MIRROR**: `SkillRule`, `SkillConfidence`, `AnalysisResult`, and `SessionState`.
- **IMPORTS**: Existing local type imports only.
- **GOTCHA**: Keep old state/cache shapes readable.
- **VALIDATE**: Unit tests compile with old skill-only fixtures.

### Task 2: Discover OpenCode Commands
- **ACTION**: Create `command-discovery.ts`.
- **IMPLEMENT**: Load commands from:
  - active `opencode.json` `command` object when path is configured or discoverable.
  - global command markdown directory under active config, especially `D:\AI\OpenCode\runtime\config\opencode\commands`.
  - project `.opencode/commands`.
  - optional `OPENCODE_COMMANDS_DIR` / `OPENCODE_CONFIG_PATH` env overrides for deterministic tests and local runtime.
- **MIRROR**: `skill-discovery.ts` frontmatter parsing, body description, unreadable-file skipping.
- **IMPORTS**: `fs`, `path`, existing `parseFrontmatter` can be shared or duplicated with a generic helper.
- **GOTCHA**: OpenCode docs use both config `command` and markdown files; do not assume commands only live in folders.
- **VALIDATE**: Tests for config-only command, markdown-only command, duplicate command precedence, and missing dirs.

### Task 3: Extend Intent Prompt And AI Parsing
- **ACTION**: Update AI prompt template and parser.
- **IMPLEMENT**: Add available commands section with `name`, `description`, source, and a short body preview only for relevance scoring. Response JSON should include:
  - `skills`: existing array.
  - `commands`: array of `{ "name": "...", "confidence": 0.91, "reason": "..." }`.
- **MIRROR**: `buildSkillDescriptions`, `parseIntentAnalysis`, and provider-agnostic prompt flow in `ai-client.ts`.
- **IMPORTS**: Existing `SkillRule` plus new `CommandRule`.
- **GOTCHA**: Keep the model output backwards compatible if `commands` is absent. Older cached/keyword results should still work.
- **VALIDATE**: Parser tests for skill-only JSON, command-aware JSON, malformed command entries, and score maps.

### Task 4: Add Command Scoring And Filtration
- **ACTION**: Add command categorization.
- **IMPLEMENT**:
  - mandatory commands: confidence >= `COMMAND_REQUIRED_THRESHOLD` default `0.90`.
  - suggested commands: confidence >= `COMMAND_SUGGESTED_THRESHOLD` default `0.70` and < `0.90`.
  - default caps should be explicit, for example `MAX_REQUIRED_COMMANDS = 3`, `MAX_SUGGESTED_COMMANDS = 5`, unless user sets env overrides.
  - no suggested-to-required promotion for commands unless explicitly requested later.
- **MIRROR**: Sorting/capping pattern from `categorizeSkills`.
- **IMPORTS**: constants and command types.
- **GOTCHA**: The user's requested 90% and 70-89% thresholds should not accidentally change skill thresholds.
- **VALIDATE**: Boundary tests at 0.89, 0.90, 0.70, 0.69.

### Task 5: Inject Command References Safely
- **ACTION**: Add command formatting and injection.
- **IMPLEMENT**:
  - `formatMandatoryCommandReferences(commandNames, commandRules, scores)` returns concise instruction text listing `/command-name` references for high-confidence commands.
  - `formatSuggestedCommandReferences(commandNames, commandRules, scores)` returns concise optional command recommendations.
  - Include description metadata when useful, but do not include full command body/template text.
  - Escape or sanitize command names/descriptions before formatting.
  - Do not execute, expand, or paste command placeholders.
- **MIRROR**: `formatRecommendedSection`.
- **IMPORTS**: command types and formatter helpers.
- **GOTCHA**: Discovery may read command bodies for scoring previews, but runtime injection must output only `/command-name` plus concise metadata.
- **VALIDATE**: Formatter tests prove command bodies containing `!` shell placeholders are not present in injected output.

### Task 6: Wire Runtime Hook
- **ACTION**: Update `experimental.chat.system.transform`.
- **IMPLEMENT**:
  - Load command rules once at plugin initialization.
  - Analyze user prompt against skills and commands.
  - Filter available command names.
  - Read acknowledged commands from state.
  - Push command summary and command references to `output.system`.
  - Write updated acknowledged skills and commands.
- **MIRROR**: Current skill flow in `index.ts`.
- **IMPORTS**: command discovery, command filtration, command formatting, extended state helpers.
- **GOTCHA**: Keep `runtimeState.injected` semantics unchanged so duplicate prevention still gates one injection pass per transform cycle.
- **VALIDATE**: Hook-level test or live OpenCode proof with debug logs showing selected commands and no repeated command injection in same session.

### Task 7: Update CLI And MCP Surfaces
- **ACTION**: Expose command analysis results to non-live surfaces.
- **IMPLEMENT**:
  - CLI JSON should include `commands`, `suggestedCommands`, and `commandScores`.
  - MCP should preserve `select_skills` compatibility and either add command fields to `structuredContent` or expose a new `select_context` tool.
- **MIRROR**: Current `selectSkills` and `selectSkillsTool` result assembly.
- **IMPORTS**: command discovery and command filtration modules.
- **GOTCHA**: Existing callers expecting `skills` and `suggested` must not break.
- **VALIDATE**: Existing CLI/MCP tests plus new command-aware result-shape tests.

### Task 8: Documentation And Runtime Verification
- **ACTION**: Update docs only if behavior changes are not already documented.
- **IMPLEMENT**: Add env vars, safety notes, command source priority, and verification examples.
- **MIRROR**: `opencode/README.md` environment variable table and runtime notes.
- **IMPORTS**: N/A.
- **GOTCHA**: Do not overstate OpenCode internals beyond official docs and observed runtime behavior.
- **VALIDATE**: `npm run check`, `npm run test`, `npm run test:coverage`, `npm run build`, then live `opencode run` verification with isolated injector.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Discover config command | `opencode.json` command object with `template` | Command rule with body/template | No |
| Discover markdown command | frontmatter plus body | Command rule with description/body/source | No |
| Missing command dirs | nonexistent path | Empty registry, no throw | Yes |
| Duplicate command source | same command in config and markdown | Deterministic precedence documented in test | Yes |
| Required threshold | confidence `0.90` | mandatory command | Yes |
| Below required | confidence `0.89` | suggested command | Yes |
| Suggested threshold | confidence `0.70` | suggested command | Yes |
| Below suggested | confidence `0.69` | ignored command | Yes |
| Mandatory reference injection | selected command with body | Output lists `/command-name` without full body | No |
| No body leakage | body contains `!npm test` | Output excludes body and no command runs | Yes |
| State compatibility | old state with only `acknowledgedSkills` | Reads skills and empty commands | Yes |
| MCP compatibility | existing `select_skills` request | Existing fields still present | Yes |

### Edge Cases Checklist
- [ ] Empty command registry.
- [ ] Config command without valid template.
- [ ] Markdown command without frontmatter.
- [ ] Invalid JSON in configured command file path.
- [ ] Duplicate command names across sources.
- [ ] Very long command body used only for scoring preview.
- [ ] Command description contains XML-sensitive characters.
- [ ] Command body contains shell placeholders.
- [ ] Command body contains file references.
- [ ] AI response omits `commands`.
- [ ] AI response includes unknown command names.
- [ ] Existing state file lacks command fields.
- [ ] Repeated prompt in same session.

---

## Validation Commands

Run from `D:\AI\Plugins\dynamicskillsinjector\opencode`.

### Static Analysis
```powershell
npm run check
```
EXPECT: Zero type errors.

### Unit Tests
```powershell
npm run test
```
EXPECT: All tests pass, including new command discovery/scoring/formatting tests.

### Coverage
```powershell
npm run test:coverage
```
EXPECT: Hook library remains at or above the established coverage target; package-wide CLI/MCP coverage limitations should be reported honestly if unchanged.

### Build
```powershell
npm run build
```
EXPECT: `dist/` builds cleanly.

### Required ECC Quality Gates
```text
/plankton-code-quality
/quality-gate
```
EXPECT: No unresolved code-quality or ECC quality-pipeline issues for the affected scope, or any environment limitation is documented with exact evidence and remediation.

### OpenCode Config Proof
```powershell
opencode debug info
```
EXPECT: config loads, `dynamic-skills-injector.js` listed, `open-agent-skills.js` not listed during isolated verification.

### Live OpenCode Verification
Use the isolated plugin setup and debug logging. Do not count CLI-only smoke tests as live proof.

Prompts:
- `Use the PRP workflow to plan a TypeScript feature in this repo.`
  - EXPECT: mandatory `/prp-plan` reference if confidence >= 0.90, without full `prp-plan.md` body pasted into system context.
- `Review my uncommitted TypeScript changes and check for security issues.`
  - EXPECT: likely command recommendation or injection for `code-review`, maybe `security-review` as suggested/required depending confidence.
- Repeat a related prompt in the same session.
  - EXPECT: duplicate command injection prevention works.
- `What is the weather today?`
  - EXPECT: no irrelevant command injection.

Required proof:
- session ID or runtime identifier.
- plugin hook firing evidence.
- selected command names.
- mandatory vs suggested command tiers.
- injected command-reference section excerpt or output size.
- evidence that command bodies/placeholders were not injected or executed by the injector.
- evidence that `open-agent-skills` was inactive during the test.

---

## Acceptance Criteria
- [ ] Command discovery reads active OpenCode config commands and command markdown files.
- [ ] Mandatory command reference injection uses confidence >= 0.90.
- [ ] Suggested commands use confidence >= 0.70 and < 0.90.
- [ ] Mandatory commands are listed as `/command-name` references, not full command bodies.
- [ ] Suggested commands are listed as optional `/command-name` references.
- [ ] Command placeholders are not injected, executed, or expanded by the injector.
- [ ] Duplicate prevention tracks commands separately from skills.
- [ ] Existing skill injection behavior remains unchanged unless explicitly modified.
- [ ] Existing CLI/MCP consumers remain compatible.
- [ ] Typecheck, tests, coverage, and build pass.
- [ ] Required `/plankton-code-quality` pass is completed or any limitation is documented.
- [ ] Required `/quality-gate` pass is completed or any limitation is documented.
- [ ] Live OpenCode verification proves hook-time command injection.

## Completion Checklist
- [ ] Code follows discovered module patterns.
- [ ] Error handling matches current no-throw hook behavior.
- [ ] Debug logs include names and tiers but no command bodies or secrets.
- [ ] Tests follow current Vitest style.
- [ ] Required `/plankton-code-quality` and `/quality-gate` command passes have been run.
- [ ] No hardcoded user-only paths except in test fixtures.
- [ ] Docs updated only where behavior changed.
- [ ] No edits to unrelated OpenCode config.
- [ ] No dynamic slash-command registration.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Command bodies accidentally leak into context | Medium | High | Formatter tests must assert body text is absent from mandatory/suggested command output. |
| Command placeholders are accidentally executed | Low | Critical | Never execute command body text; add tests with shell placeholders. |
| AI over-selects commands | Medium | Medium | Use 0.90 mandatory threshold and no command promotion. |
| Existing skill-only cache shape breaks command results | Medium | Medium | Version cache keys and keep parser backward compatible. |
| Active OpenCode command source precedence is misunderstood | Medium | Medium | Prefer explicit env/config path, document precedence, and verify against `opencode debug config` if needed. |
| MCP callers break on changed result shape | Low | High | Add fields without removing existing fields or add a new tool. |

## Notes
- Official OpenCode docs confirm commands are prompt templates exposed through config or command markdown files, and plugin command events are lifecycle events rather than command definitions.
- Full command-body injection is explicitly out of scope for the default behavior because commands can be long and context-heavy. The implementation should inject `/command-name` references only.
- The cleanest initial implementation is to analyze skills and commands in one AI call to avoid duplicate provider latency and conflicting intent interpretations.

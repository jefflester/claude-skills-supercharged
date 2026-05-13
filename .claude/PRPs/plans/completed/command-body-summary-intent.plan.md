# Plan: Command Body Summary Intent Analysis

## Summary
Add short extracted command-body summaries to command intent analysis so the model understands what a command actually does without receiving or injecting full command bodies. The summary should be deterministic, bounded, sanitized, cache-friendly, include workflow phase context when known, and be used only for intent scoring context.

This plan directly uses the useful ECC surfaces for this work: `prompt-optimizer`, `codebase-onboarding`, `workspace-surface-audit`, `plankton-code-quality`, `quality-gate`, `verification-loop`, `/prp-plan`, `/prp-implement`, `/quality-gate`, `/code-review`, and the sub-agents `build-error-resolver`, `typescript-reviewer`, `silent-failure-hunter`, `performance-optimizer`, `code-simplifier`, and `doc-updater` when docs become inaccurate.

## User Story
As a Dynamic Skills Injector user, I want command intent analysis to see concise command behavior summaries, so that commands are selected based on workflow meaning rather than command names or thin descriptions.

## Problem -> Solution
Commands currently provide `name: description` to the intent analyzer. Some command descriptions are too thin, while full command bodies are too context-heavy and can leak command syntax into the intent prompt. Add a deterministic extracted summary field derived from command frontmatter/body and workflow-phase mapping, then pass `name: description | workflow phase | summary` to intent analysis while preserving pointer-only injection.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 8-12
- **Primary Coding Agent**: `build-error-resolver`
- **Required Review Agents**: `typescript-reviewer`, `silent-failure-hunter`
- **Conditional Review Agents**: `performance-optimizer`, `code-simplifier`, `doc-updater`
- **Required Skills**: `prompt-optimizer`, `codebase-onboarding`, `workspace-surface-audit`, `plankton-code-quality`, `quality-gate`, `verification-loop`
- **Required Commands**: `/prp-implement`, `/quality-gate`, `/code-review`
- **Optional Commands**: `/update-docs` only if README or user-facing docs become inaccurate

---

## UX Design

### Before
Internal change — no user-facing UI.

### After
Internal change — no user-facing UI.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| AI intent prompt | Commands are shown as `command-name: description` | Commands are shown as `command-name: description; summary` | Summary is bounded and sanitized |
| System injection | Command pointer references only | Command pointer references only | Do not inject command bodies or summaries into user-visible system reference blocks unless debug-only evidence is explicitly needed |
| Debug evidence | Existing debug logs show selected references | May include summary metadata only in debug tests/logs if useful | Avoid logging full command body |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `opencode/hooks/lib/command-discovery.ts` | 169-412 | Command frontmatter/config parsing and registry merge |
| P0 | `opencode/hooks/lib/ai-client.ts` | 146-170 | Skill and command prompt-description construction |
| P0 | `opencode/hooks/lib/intent-analyzer.ts` | 152-292 | Command candidate selection, fingerprinting, and AI call path |
| P0 | `opencode/hooks/lib/types.ts` | all | `CommandRule` contract must gain summary metadata safely |
| P1 | `opencode/hooks/lib/__tests__/command-discovery.test.ts` | 17-240 | Discovery test style and security expectations |
| P1 | `opencode/hooks/lib/__tests__/command-ai-client.test.ts` | 21-70 | Prompt construction tests |
| P1 | `opencode/hooks/lib/__tests__/command-intent-analyzer.test.ts` | 59-155 | Command intent candidate tests |
| P1 | `opencode/hooks/__tests__/command-hook-behavior.test.ts` | all | Ensures command bodies are not injected |
| P2 | `opencode/hooks/config/intent-analysis-prompt.txt` | all | Prompt wording for command analysis |
| P0 | Embedded command workflow-phase table below | all | Canonical implementation input for command workflow phases |

## External Documentation

No external research needed — feature uses established internal parsing, test, and prompt construction patterns.

---

## Required ECC Process

### Skills To Apply
| Skill | Use In This Plan |
|---|---|
| `prompt-optimizer` | Draft and review summary wording/rubric: summaries must explain workflow meaning, not copy command prose or syntax |
| `codebase-onboarding` | Trace command discovery -> intent prompt -> selection -> injection path before editing |
| `workspace-surface-audit` | Confirm command sources: OpenCode `opencode.json` commands and markdown files under the active commands dirs |
| `plankton-code-quality` | Keep summary extraction deterministic, small, testable, and low-context |
| `quality-gate` | Run final verification gate before commit |
| `verification-loop` | Run targeted tests, full tests, typecheck, build, and threshold matrix |

### Commands To Apply
| Command | Use In This Plan |
|---|---|
| `/prp-implement` | Execute this plan |
| `/quality-gate` | Final quality validation after implementation |
| `/code-review` | Review final diff for correctness and risks |
| `/update-docs` | Use only if README/config docs need to mention command summaries |

### Sub-Agents To Use
| Sub-Agent | Responsibility |
|---|---|
| `build-error-resolver` | Primary implementation agent for TypeScript changes |
| `typescript-reviewer` | Review type contracts, test coverage, and TS idioms |
| `silent-failure-hunter` | Look for summary extraction failures that silently degrade intent selection |
| `performance-optimizer` | Check that summaries are computed once during discovery/cache flow, not repeatedly or with unbounded body scans |
| `code-simplifier` | Simplify extraction helpers after behavior is correct |
| `doc-updater` | Only update docs if command summary behavior becomes user-facing or README-visible |

---

## Patterns to Mirror

### COMMAND_METADATA_DISCOVERY
// SOURCE: `opencode/hooks/lib/command-discovery.ts:258-412`
Command metadata is parsed from markdown frontmatter and OpenCode config, then markdown/config registries are merged with config winning duplicates. Add summary extraction in this lane so command summaries are created once during discovery.

### EMBEDDED_COMMAND_WORKFLOW_PHASE_MAPPING
The following table is the command workflow-phase mapping to implement. It is embedded here as the source of truth for this implementation. Do not parse any external workflow-phase document at implementation time.

The former `commands/*` aliases were duplicate compatibility shims. Each one had a matching non-prefixed command and was removed from the active OpenCode config before implementation. Do not recreate them.

| Command | Workflow Phase |
|---|---|
| `/build-fix` | Build Fixers |
| `/cpp-build` | Build Fixers |
| `/flutter-build` | Build Fixers |
| `/gan-build` | Build Fixers |
| `/go-build` | Build Fixers |
| `/gradle-build` | Build Fixers |
| `/kotlin-build` | Build Fixers |
| `/rust-build` | Build Fixers |
| `/code-review` | Code Review |
| `/cpp-review` | Code Review |
| `/eval` | Code Review |
| `/flutter-review` | Code Review |
| `/go-review` | Code Review |
| `/kotlin-review` | Code Review |
| `/python-review` | Code Review |
| `/quality-gate` | Code Review |
| `/review-pr` | Code Review |
| `/rust-review` | Code Review |
| `/security` | Code Review |
| `/database-migration` | Core Workflow |
| `/feature-dev` | Core Workflow |
| `/feature-development` | Core Workflow |
| `/prompt-optimize` | Core Workflow |
| `/santa-loop` | Core Workflow |
| `/docs` | Docs & Research |
| `/update-codemaps` | Docs & Research |
| `/update-docs` | Docs & Research |
| `/evolve` | Learning & Improvement |
| `/instinct-export` | Learning & Improvement |
| `/instinct-status` | Learning & Improvement |
| `/learn` | Learning & Improvement |
| `/learn-eval` | Learning & Improvement |
| `/promote` | Learning & Improvement |
| `/rules-distill` | Learning & Improvement |
| `/skill-create` | Learning & Improvement |
| `/claw` | Loops & Automation |
| `/devfleet` | Loops & Automation |
| `/loop-start` | Loops & Automation |
| `/loop-status` | Loops & Automation |
| `/multi-backend` | Loops & Automation |
| `/multi-execute` | Loops & Automation |
| `/multi-frontend` | Loops & Automation |
| `/multi-workflow` | Loops & Automation |
| `/orchestrate` | Loops & Automation |
| `/prp-implement` | Loops & Automation |
| `/council` | Planning & Architecture |
| `/gan-design` | Planning & Architecture |
| `/hookify-configure` | Planning & Architecture |
| `/hookify-list` | Planning & Architecture |
| `/instinct-import` | Planning & Architecture |
| `/multi-plan` | Planning & Architecture |
| `/plan` | Planning & Architecture |
| `/prp-plan` | Planning & Architecture |
| `/prp-prd` | Planning & Architecture |
| `/add-language-rules` | Project & Infrastructure |
| `/auto-update` | Project & Infrastructure |
| `/harness-audit` | Project & Infrastructure |
| `/jira` | Project & Infrastructure |
| `/pm2` | Project & Infrastructure |
| `/projects` | Project & Infrastructure |
| `/setup-pm` | Project & Infrastructure |
| `/refactor-clean` | Refactoring & Cleanup |
| `/aside` | Session Management |
| `/checkpoint` | Session Management |
| `/context-budget` | Session Management |
| `/hookify` | Session Management |
| `/hookify-help` | Session Management |
| `/model-route` | Session Management |
| `/prp-commit` | Session Management |
| `/prp-pr` | Session Management |
| `/prune` | Session Management |
| `/resume-session` | Session Management |
| `/save-session` | Session Management |
| `/sessions` | Session Management |
| `/skill-health` | Session Management |
| `/cpp-test` | Testing |
| `/e2e` | Testing |
| `/flutter-test` | Testing |
| `/go-test` | Testing |
| `/kotlin-test` | Testing |
| `/rust-test` | Testing |
| `/tdd` | Testing |
| `/test-coverage` | Testing |
| `/verify` | Testing |

Removed duplicate aliases:

| Ignored Alias | Canonical Command |
|---|---|
| `/commands/claw` | `/claw` |
| `/commands/context-budget` | `/context-budget` |
| `/commands/devfleet` | `/devfleet` |
| `/commands/docs` | `/docs` |
| `/commands/e2e` | `/e2e` |
| `/commands/eval` | `/eval` |
| `/commands/orchestrate` | `/orchestrate` |
| `/commands/prompt-optimize` | `/prompt-optimize` |
| `/commands/rules-distill` | `/rules-distill` |
| `/commands/security` | `/security` |
| `/commands/tdd` | `/tdd` |
| `/commands/verify` | `/verify` |

Categorization decision that still needs user review: `/add-language-rules` was not included in the user-provided category list, so this plan places it in `Project & Infrastructure` because it is an ECC/project setup command scaffold.

### PROMPT_DESCRIPTION_FORMAT
// SOURCE: `opencode/hooks/lib/ai-client.ts:146-170`
Skills and commands are rendered for the AI prompt through small formatting helpers. Extend `buildCommandDescriptions`, not the provider clients.

### CANDIDATE_CACHE_FINGERPRINT
// SOURCE: `opencode/hooks/lib/intent-analyzer.ts:189-292`
Command metadata fingerprinting controls cache invalidation. Include summary metadata so changed summaries invalidate stale cached intent results.

### TEST_STYLE
// SOURCE: `opencode/hooks/lib/__tests__/command-discovery.test.ts:17-240`
Tests use small inline markdown/config fixtures and assert exact parsed metadata.

### BODY_SAFETY
// SOURCE: `opencode/hooks/__tests__/command-hook-behavior.test.ts`
Existing tests protect against command body/template injection. Preserve and extend this protection.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `opencode/hooks/lib/types.ts` | UPDATE | Add optional `summary?: string` or `bodySummary?: string` to `CommandRule` |
| `opencode/hooks/lib/command-discovery.ts` | UPDATE | Extract deterministic summaries from markdown/config command bodies |
| `opencode/hooks/lib/ai-client.ts` | UPDATE | Include summaries in command descriptions sent to intent analyzer |
| `opencode/hooks/lib/intent-analyzer.ts` | UPDATE | Include summary in command fingerprint and possibly candidate scoring metadata |
| `opencode/hooks/lib/command-phase-map.ts` or equivalent | CREATE or UPDATE | Store deterministic command -> workflow phase map from the embedded table in this plan |
| `opencode/hooks/lib/__tests__/command-discovery.test.ts` | UPDATE | Test summary extraction from frontmatter/body/config |
| `opencode/hooks/lib/__tests__/command-ai-client.test.ts` | UPDATE | Test prompt includes summary but not full command body |
| `opencode/hooks/lib/__tests__/command-intent-analyzer.test.ts` | UPDATE | Test summaries influence candidate selection/AI context |
| `opencode/hooks/__tests__/command-hook-behavior.test.ts` | UPDATE if needed | Ensure injected reference output still excludes full bodies |
| `opencode/README.md` | UPDATE only if needed | Only if summary behavior is user-facing enough to document |

## NOT Building

- No live AI-generated command summaries at runtime.
- No full command body injection.
- No generic shared skills/commands reference-analysis refactor.
- No command execution.
- No changing threshold defaults unless separately approved.
- No editing command files in `D:\AI\GlobalRepo\commands` unless explicitly requested.

---

## Step-by-Step Tasks

### Task 1: Audit Command Sources
- **ACTION**: Use `workspace-surface-audit` and `codebase-onboarding` to confirm active command sources.
- **IMPLEMENT**: Read command discovery paths and current OpenCode config command shape.
- **MIRROR**: Existing `discoverCommands` merge behavior.
- **IMPORTS**: None.
- **GOTCHA**: Do not assume commands only come from markdown; OpenCode config commands also matter.
- **VALIDATE**: Confirm tests cover both markdown frontmatter and config command objects.

### Task 2: Add Command Summary Contract
- **ACTION**: Add optional command summary metadata.
- **IMPLEMENT**: Add `summary?: string` or `bodySummary?: string` and `workflowPhase?: string` to `CommandRule`.
- **MIRROR**: Existing optional command metadata in `CommandRule`.
- **IMPORTS**: None.
- **GOTCHA**: Keep the field optional for backwards compatibility.
- **VALIDATE**: `npm run check`.

### Task 3: Build Command Workflow Phase Map
- **ACTION**: Add workflow-phase categorization for commands.
- **IMPLEMENT**:
  - Use the embedded command workflow-phase table in this plan as the source of truth.
  - Encode the command-to-phase map in code or a small fixture consumed by command discovery.
  - Do not recreate removed `commands/*` duplicate aliases.
  - Add `workflowPhase` to each discovered command when a mapping exists.
- **MIRROR**: Existing static metadata helpers in command discovery; keep this deterministic and dependency-free.
- **IMPORTS**: Avoid runtime markdown table parsing. Prefer a generated/static map checked into source.
- **GOTCHA**: The embedded table intentionally excludes removed `commands/*` duplicate aliases and includes only command categories, not skill categories.
- **VALIDATE**: Unit tests assert mapped commands get the expected workflow phase and unmapped commands can be reported.

### Task 4: Validate Command Phase Coverage
- **ACTION**: Compare active non-prefixed command inventory against the embedded phase map.
- **IMPLEMENT**:
  - Confirm every active non-prefixed command has a workflow phase.
  - Confirm removed `commands/*` aliases are not present in the active command registry.
  - Report `/add-language-rules` as the only implementer-chosen category if the user has not confirmed it.
- **MIRROR**: The phase names must match exactly:
  1. Core Workflow
  2. Project & Infrastructure
  3. Docs & Research
  4. Planning & Architecture
  5. Loops & Automation
  6. Session Management
  7. Build Fixers
  8. Code Review
  9. Testing
  10. Refactoring & Cleanup
  11. Learning & Improvement
  12. UI/UX/Media
  13. Industry Misc
  14. Misc
- **GOTCHA**: Do not silently include duplicate aliases in phase counts or maps; they were compatibility shims and should stay removed.
- **VALIDATE**: Add a test or script output that lists uncategorized active non-prefixed commands; expected result should be empty.

### Task 5: Implement Deterministic Summary Extraction
- **ACTION**: Create a small helper in `command-discovery.ts`.
- **IMPLEMENT**:
  - Prefer explicit frontmatter/config `summary` when provided.
  - Add workflow phase text when known, for example: `Workflow phase: Testing.`
  - Otherwise derive from `description` plus the first meaningful command body lines/headings.
  - Strip frontmatter, code fences, shell command lines, file references, `$ARGUMENTS`, `!command`, `@file`, and long templates.
  - Collapse whitespace.
  - Cap output length, for example 240-360 chars.
- **MIRROR**: `parseFrontmatter`, `parseStringList`, and small local helper style in `command-discovery.ts`.
- **IMPORTS**: Avoid new dependencies.
- **GOTCHA**: Summary extraction must never include secrets, command invocations, or full command bodies.
- **VALIDATE**: Add tests with command bodies containing `!npm test`, `@secret`, `$ARGUMENTS`, code fences, and headings. Add tests that summaries include workflow phase when mapped.

### Task 6: Include Summary In AI Prompt Context
- **ACTION**: Update `buildCommandDescriptions`.
- **IMPLEMENT**: Render command prompt context as `- command-name: description. Workflow phase: phase. Summary: short summary` when metadata exists.
- **MIRROR**: `buildSkillDescriptions` and current `buildCommandDescriptions`.
- **IMPORTS**: None.
- **GOTCHA**: Do not include `template` or source path in the AI prompt.
- **VALIDATE**: Test prompt contains the summary and does not contain full body text or command syntax.

### Task 7: Include Summary In Candidate/Fingerprint Context
- **ACTION**: Update command candidate scoring and cache fingerprint.
- **IMPLEMENT**:
  - Include `workflowPhase` and `summary` in `buildCommandMetadataFingerprint`.
  - Include `workflowPhase` and `summary` in the command-to-skill-like description used by command candidate selection.
- **MIRROR**: Existing command fingerprint metadata structure.
- **IMPORTS**: None.
- **GOTCHA**: Cache key must change when summary logic changes; bump cache prefix, for example `candidate-v5`.
- **VALIDATE**: Unit test or inspection confirms summary changes invalidate cache via fingerprint.

### Task 8: Preserve Pointer-Only Injection
- **ACTION**: Verify output formatting remains pointer-only.
- **IMPLEMENT**: Do not add summaries to required/suggested command injected blocks unless a future debug-only flag is explicitly requested.
- **MIRROR**: Existing command output formatter pointer behavior.
- **IMPORTS**: None.
- **GOTCHA**: Intent prompt context and injected system reference text are different surfaces.
- **VALIDATE**: Hook behavior tests assert body/summary/full command text is not injected into `output.system` reference blocks.

### Task 9: Verification Matrix
- **ACTION**: Run `verification-loop` and `/quality-gate`.
- **IMPLEMENT**: Run validation commands listed below.
- **MIRROR**: Previous threshold matrix methodology.
- **IMPORTS**: None.
- **GOTCHA**: Use fresh `.verification` output directory to avoid cache contamination.
- **VALIDATE**: Compare command selection before/after for false positives like `build-fix`.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Markdown frontmatter summary | `summary: Run final validation` | command rule summary equals explicit summary | No |
| Workflow phase mapping | `/test-coverage` command | workflow phase equals `Testing` | No |
| Missing command mapping | active alias command | provisional phase recorded and applied | Yes |
| Markdown derived summary | Description plus headings/body | bounded summary, no full body | No |
| Sanitization | body contains `!npm test`, `@secret`, `$ARGUMENTS` | summary excludes those tokens | Yes |
| Config command summary | config object has `summary` | command rule includes summary | No |
| AI prompt rendering | command with summary and dangerous template | prompt includes summary, excludes template | Yes |
| Cache fingerprint | command summary changes | fingerprint/cache key changes | Yes |
| Hook output | selected command with summary | system reference stays pointer-only | Yes |

### Edge Cases Checklist
- [ ] Empty template
- [ ] Template with only shell/file placeholder lines
- [ ] Very long command body
- [ ] Markdown headings without paragraphs
- [ ] Explicit summary longer than cap
- [ ] Config command with missing description
- [ ] Duplicate command from markdown/config
- [ ] Command body containing secrets-like tokens

---

## Validation Commands

### Focused Tests
```bash
npm run test -- command
```
EXPECT: All command-related tests pass.

### Full Test Suite
```bash
npm run test
```
EXPECT: No regressions.

### Static Analysis
```bash
npm run check
```
EXPECT: Zero type errors.

### Build
```bash
npm run build
```
EXPECT: Build succeeds.

### Diff Hygiene
```bash
git diff --check
```
EXPECT: No whitespace errors. CRLF warnings are acceptable on this Windows repo if no actual whitespace errors appear.

### Manual/Live Selection Check
Run the same complex prompt threshold matrix used previously, with fresh cache directory:

```text
Build a TypeScript CLI and MCP-compatible workflow for scanning a repository, generating a JSON dependency and security report, caching results, adding tests with 80 percent coverage, updating README docs, and verifying the behavior in a live OpenCode session without modifying unrelated files.
```

EXPECT:
- Command selection should be more semantically grounded.
- `build-fix` should not appear unless the command body summary genuinely supports it for the prompt.
- `security`, `tdd`, `test-coverage`, and `verify` should be explainable by workflow intent, not keyword overlap alone.

---

## Acceptance Criteria
- [ ] Command summaries are available on `CommandRule`.
- [ ] Command workflow phase is available on `CommandRule` when mapped.
- [ ] Workflow phase mapping uses only command rows from the Flock quick reference.
- [ ] Missing command categorization decisions are documented for user review.
- [ ] Summaries are extracted deterministically from config/frontmatter/body.
- [ ] Full command bodies are never sent to the intent prompt.
- [ ] Full command bodies are never injected into system reference output.
- [ ] Command summaries are included in AI intent prompt context.
- [ ] Summary metadata participates in cache invalidation.
- [ ] Focused command tests pass.
- [ ] Full test/check/build pass.
- [ ] Threshold matrix results are reported.

## Completion Checklist
- [ ] Code follows existing command discovery patterns.
- [ ] No new runtime dependencies.
- [ ] No full body/context bloat.
- [ ] Summary extraction is bounded and sanitized.
- [ ] Tests cover markdown and config commands.
- [ ] `typescript-reviewer` review comments are addressed.
- [ ] `silent-failure-hunter` review comments are addressed.
- [ ] `performance-optimizer` review comments are addressed if any runtime overhead risk is identified.
- [ ] `code-simplifier` review comments are addressed after behavior is stable.
- [ ] `doc-updater` used only if docs become inaccurate.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Summaries still include noisy procedural text | Medium | Medium | Sanitization tests and `silent-failure-hunter` review |
| Summary extraction removes too much useful context | Medium | Medium | Keep description plus first meaningful prose lines |
| Runtime overhead from summary extraction | Low | Medium | Extract once during command discovery, cap scanned lines/chars |
| Cache returns stale command choices | Medium | High | Include summary in fingerprint and bump cache version prefix |
| Overfitting to one threshold prompt | Medium | Medium | Use multiple prompt checks if time allows |

## Notes
- Deterministic summaries are the recommended first implementation. Live AI-generated summaries should remain out of scope because they add latency, cost, cache complexity, and another source of nondeterminism.
- This feature improves the command intent context, but does not by itself solve mandatory command over-promotion. Treat promotion policy as a separate follow-up unless explicitly approved.

# Plan: Full Audit Remediation — All 39 Findings

## Summary
Remediate every finding (2 CRITICAL, 10 HIGH, 18 MEDIUM, 9 LOW) from the 7-agent comprehensive audit of the `opencode/` fork diff against upstream `jefflester/claude-skills-supercharged`. The work is organized into 8 phases with strict sequencing: security-critical fixes first, then error handling, type safety, DRY extraction, test coverage, hardening, minor polish, and final quality gates. No finding is excluded.

## User Story
As a maintainer of this fork, I need every audit finding fixed so the branch can pass security review, meet the 80% test coverage minimum, satisfy ECC quality gates, and be merge-ready.

## Problem -> Solution
The 7-agent audit found: prompt injection (CRIT), path construction risk (CRIT), no API timeouts (HIGH), regex logic bug (HIGH), ~300 lines of DRY violation (HIGH), ~50-55% test coverage (below 80% minimum), object mutation (HIGH), `any` in validator (HIGH), unconditional stderr leaks (HIGH), unbounded session map (HIGH), no rate limiting (HIGH), SSRF risk (HIGH), bare catch swallowing errors (HIGH), plus 18 MEDIUM and 9 LOW issues. This plan fixes all of them in dependency order with test-first methodology, parallel sub-agent delegation, and mandatory quality gates at each phase boundary.

## Metadata
- **Complexity**: Extra Large
- **Source**: 7-agent audit report (2026-05-14)
- **Estimated Files**: 25-30 modified, 8-12 new test files
- **Branch**: `codex/command-body-injection-prp` (continue on current branch)
- **Baseline Commit**: `25f8439` (fix: align command threshold handling)

---

## Workspace Surface Audit

### Current Surface
- Repo root: `D:\AI\Plugins\dynamicskillsinjector`
- Runtime package: `opencode/`
- Upstream: `https://github.com/jefflester/claude-skills-supercharged.git` (remote: `upstream`)
- Fork: `https://github.com/trader-RM/dynamicskillsinjector.git` (remote: `origin`)
- 7 commits ahead of upstream/main, 50 files changed, +12,722 lines

### ECC Skills To Use (Overinclusive)

#### Orchestrator-Level Skills (used by the main session)
| Skill | When | Purpose |
|---|---|---|
| `prp-plan` | Phase 0 | This plan artifact |
| `prp-implement` | All phases | Execute implementation with validation loops |
| `workspace-surface-audit` | Phase 0 | Confirm file and config surfaces before implementation |
| `team-builder` | Phase 0 | Compose and dispatch parallel specialist teams per phase |
| `model-route` | Phase 0 | Route each sub-agent to optimal model tier |
| `prompt-optimizer` | Every delegation | Draft optimized prompts for each sub-agent before dispatch |
| `verification-loop` | Phase boundaries | Run check/test/build verification between phases |
| `quality-gate` | Phase 7 | Final ECC quality pipeline pass |
| `plankton-code-quality` | Phase 7 | Write-time code quality enforcement |
| `coding-standards` | All phases | Enforce coding conventions |
| `council` | Complex decisions | Convene multi-voice council for ambiguous tradeoffs |
| `context-budget` | Large phases | Monitor context window consumption |
| `token-budget-advisor` | Before large delegations | Advise on token budgets for sub-agent prompts |
| `agentic-engineering` | All phases | Eval-first execution, decomposition, cost-aware routing |
| `continuous-agent-loop` | Phase 5 (testing) | Continuous test-write loop until coverage target met |
| `autonomous-loops` | Phase 5 (testing) | Autonomous loop pattern for iterative test gap closure |
| `santa-method` | Phase 1 (security), Phase 7 (final) | Adversarial dual-review for security-critical changes |
| `cost-aware-llm-pipeline` | All phases | Cost optimization for multi-agent delegation |
| `checkpoint` | Phase boundaries | Create verifiable checkpoints between phases |
| `skill-comply` | Phase 7 | Verify skills and rules compliance |

#### Sub-Agent-Level Skills (provided to delegated agents)
| Skill | Which Sub-Agent | Purpose |
|---|---|---|
| `tdd-workflow` | tdd-guide | Enforce test-first RED/GREEN/IMPROVE cycle |
| `test-coverage` | tdd-guide, pr-test-analyzer | Measure and close coverage gaps |
| `e2e-testing` | e2e-runner | Playwright E2E test patterns |
| `ai-regression-testing` | tdd-guide | Regression testing for AI-assisted changes |
| `security-review` | security-reviewer | OWASP Top 10, secrets, injection checklist |
| `security-scan` | security-reviewer | AgentShield vulnerability scan |
| `security-bounty-hunter` | security-reviewer | Hunt exploitable issues |
| `code-review` | code-reviewer | General quality, patterns, best practices |
| `api-security` | security-reviewer | API endpoint security guardrails |
| `api-contract-testing` | tdd-guide | Test API contracts for MCP server |
| `deployment-patterns` | architect | Deployment and CI/CD patterns |
| `docker-patterns` | architect | Container patterns if applicable |
| `refactor-clean` | refactor-cleaner | Dead code detection and removal |
| `simplify` | code-simplifier | Post-implementation simplification |
| `repo-scan` | refactor-cleaner | Cross-stack source code audit |
| `eval-harness` | agent-eval | Evaluation framework for agent quality |
| `rules-distill` | code-reviewer | Extract cross-cutting principles |
| `plankton-code-quality` | code-reviewer | Write-time quality enforcement |

### ECC Slash Commands To Use During Implementation

| Stage | Commands |
|---|---|
| Planning and surface proof | `/prp-plan`, `/workspace-surface-audit`, `/team-builder`, `/model-route` |
| Every sub-agent delegation | `/prompt-optimizer` (draft prompt), `/model-route` (select model) |
| Test-first implementation | `/tdd-workflow`, `/test-coverage`, `/build-fix` if check/build fails |
| Security implementation | `/security-review`, `/security-scan`, `/santa-loop` (adversarial dual-review) |
| Quality cleanup | `/refactor-clean`, `/simplify`, `/coding-standards` |
| Phase boundary verification | `/verification-loop`, `/checkpoint` |
| Final quality gates | `/plankton-code-quality`, `/quality-gate`, `/code-review`, `/review-pr`, `/security-review` |
| Autonomous test coverage | `/loop-start` (for iterative test writing until 80%+), `/loop-status` |
| Decision points | `/council` (for ambiguous tradeoffs) |
| Documentation | `/update-docs`, `/update-codemaps` (only if docs changed) |
| Commit and PR | `/prp-commit`, `/prp-pr` |

### Relevant ECC Sub-Agents

Model routing (via `/model-route`):
- **Highest complexity** (architecture, security design): **Opus** (`claude-opus-4-6`)
- **Normal implementation and refactor**: **Sonnet** (`claude-sonnet-4-6`)
- **Focused review/test/mechanical tasks**: **Haiku** (`claude-haiku-4-5-20251001`)

| Agent | Role | Model Route | Skills To Provide |
|---|---|---|---|
| `security-reviewer` | CRIT-1, CRIT-2, HIGH-9, M-15, M-16, M-17 security fixes | Opus | `security-review`, `security-scan`, `security-bounty-hunter`, `api-security` |
| `code-reviewer` | Review all changes at phase boundaries | Sonnet | `code-review`, `coding-standards`, `plankton-code-quality` |
| `typescript-reviewer` | HIGH-2, HIGH-5, M-10, M-12, M-13, M-14 type fixes review | Sonnet | `coding-standards` |
| `tdd-guide` | Phase 5 test coverage expansion | Sonnet | `tdd-workflow`, `test-coverage`, `e2e-testing`, `api-contract-testing`, `ai-regression-testing` |
| `build-error-resolver` | Fix any build/type errors after changes | Haiku | `build-fix` |
| `architect` | HIGH-3 shared module extraction, M-1 file splitting | Opus | `deployment-patterns` |
| `silent-failure-hunter` | Review Phase 2 error handling fixes | Sonnet | `code-review` |
| `type-design-analyzer` | Review Phase 3 type improvements | Sonnet | `coding-standards` |
| `refactor-cleaner` | Phase 4 DRY extraction verification | Sonnet | `refactor-clean`, `repo-scan` |
| `code-simplifier` | Phase 6 minor polish | Haiku | `simplify` |
| `performance-optimizer` | M-18 sync I/O optimization review | Sonnet | N/A |
| `pr-test-analyzer` | Phase 5 test quality verification | Sonnet | `test-coverage` |
| `doc-updater` | Phase 7 README updates if needed | Haiku | `update-docs` |

---

## Findings Cross-Reference

Every finding is assigned to exactly one task. The ID column maps to the audit report.

| ID | Severity | Finding | Task |
|---|---|---|---|
| CRIT-1 | CRITICAL | Prompt injection — raw user input in AI prompt | Task 1 |
| CRIT-2 | CRITICAL | AI-returned skill names in file path construction | Task 2 |
| HIGH-1 | HIGH | No timeout on any API call | Task 3 |
| HIGH-2 | HIGH | Regex logic bug — missing word boundaries | Task 8 |
| HIGH-3 | HIGH | DRY violation — cli.ts / mcp-server.ts | Task 10 |
| HIGH-4 | HIGH | Object mutation violates immutability | Task 9 |
| HIGH-5 | HIGH | `any` abuse in schema-validator.ts | Task 8 |
| HIGH-6 | HIGH | Unconditional console.warn/error in production | Task 5 |
| HIGH-7 | HIGH | Unbounded sessionRuntimeState Map | Task 13 |
| HIGH-8 | HIGH | No rate limiting on AI API calls | Task 13 |
| HIGH-9 | HIGH | SSRF via OLLAMA_BASE_URL | Task 2 |
| HIGH-10 | HIGH | Bare catch returns empty on command discovery failure | Task 4 |
| M-1 | MEDIUM | mcp-server.ts exceeds 800 lines | Task 10 |
| M-2 | MEDIUM | AI fallback indistinguishable from success | Task 5 |
| M-3 | MEDIUM | writeCache has no error handling | Task 4 |
| M-4 | MEDIUM | Cache dir ignores SKILLS_CACHE_DIR constant | Task 11 |
| M-5 | MEDIUM | Empty catch — unreadable SKILL.md silently vanishes | Task 4 |
| M-6 | MEDIUM | writeMessage failure kills MCP loop | Task 4 |
| M-7 | MEDIUM | withConsoleSuppressed buries warnings in MCP mode | Task 5 |
| M-8 | MEDIUM | Auth JSON parse errors fully swallowed | Task 4 |
| M-9 | MEDIUM | Hardcoded regex shortcuts bypass AI | Task 9 |
| M-10 | MEDIUM | tsconfig moduleResolution mismatch | Task 8 |
| M-11 | MEDIUM | Floating processingPromise not awaited at shutdown | Task 4 |
| M-12 | MEDIUM | AnalysisResult post-construction mutation | Task 9 |
| M-13 | MEDIUM | FALLBACK_DOMAIN_MODE unsafe cast | Task 8 |
| M-14 | MEDIUM | HookEvent untagged union | Task 9 |
| M-15 | MEDIUM | Skill discovery missing symlink/traversal checks | Task 2 |
| M-16 | MEDIUM | File-path env vars trusted without validation | Task 2 |
| M-17 | MEDIUM | No max Content-Length in MCP server | Task 13 |
| M-18 | MEDIUM | Sync file I/O on every hook invocation | Task 11 |
| L-1 | LOW | forEach vs for...of inconsistency | Task 12 |
| L-2 | LOW | CACHE_SCHEMA_VERSION unexplained | Task 12 |
| L-3 | LOW | Emoji in output banners | Task 12 |
| L-4 | LOW | parseNumberOption type divergence | Task 10 |
| L-5 | LOW | No ESLint configuration | Task 14 |
| L-6 | LOW | MD5 for cache keys | Task 13 |
| L-7 | LOW | Debug log PII/behavioral data | Task 13 |
| L-8 | LOW | Prompt template from user-controlled dir | Task 2 |
| L-9 | LOW | confidence: number no range constraint | Task 9 |

---

## NOT Building

- No new features beyond what exists.
- No changes to upstream `.claude/hooks/skill-activation-prompt.ts`.
- No edits to off-limits directories (see global CLAUDE.md).
- No deletion of test files (fix or skip non-functional ones).
- No changes to `package-lock.json` unless adding ESLint devDependency.
- No changes to `.claude/skills/` project-level skills.

---

## Mandatory Reading

Files that MUST be read before each phase begins:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `opencode/hooks/lib/ai-client.ts` | 91-108, 129-141, 243, 449-455, 497-502, 534-548 | CRIT-1, HIGH-1, HIGH-9, M-8 targets |
| P0 | `opencode/hooks/lib/output-formatter.ts` | 29-40 | CRIT-2 path construction |
| P0 | `opencode/hooks/lib/intent-analyzer.ts` | 266-295, 317-374, 401-413 | HIGH-2, HIGH-4, HIGH-6, M-2, M-9, M-12 targets |
| P0 | `opencode/hooks/index.ts` | 31-81, 93, 240-307, 331-553 | HIGH-7, HIGH-10, M-14, M-18 targets |
| P0 | `opencode/hooks/lib/schema-validator.ts` | 26-61 | HIGH-5 target |
| P0 | `opencode/hooks/lib/types.ts` | 1-127 | M-12, M-14, L-9 targets |
| P0 | `opencode/hooks/lib/constants.ts` | 94-107 | M-4, M-13 targets |
| P0 | `opencode/src/cli.ts` | 54-255, 384-521 | HIGH-3 DRY source |
| P0 | `opencode/src/mcp-server.ts` | 36-240, 349-569, 742-807 | HIGH-3 DRY source, M-1, M-6, M-11, M-17 |
| P1 | `opencode/hooks/lib/cache-manager.ts` | 24-26, 43-50, 94-107, 133-155 | M-3, M-4 targets |
| P1 | `opencode/hooks/lib/skill-discovery.ts` | 175-183 | M-5, M-15 targets |
| P1 | `opencode/hooks/lib/skill-resolution.ts` | 69-72 | HIGH-6 target |
| P1 | `opencode/hooks/lib/command-filtration.ts` | 68-70 | HIGH-6 target |
| P1 | `opencode/hooks/lib/skill-state-manager.ts` | 32, 86 | Related to state type fixes |
| P1 | `opencode/hooks/lib/intent-scorer.ts` | 85-111 | L-1 target |
| P1 | `opencode/hooks/lib/debug-logger.ts` | 1-53 | Logging pattern reference |
| P1 | `opencode/hooks/config/intent-analysis-prompt.txt` | 1-98 | CRIT-1 prompt template |
| P1 | `opencode/tsconfig.json` | 1-26 | M-10 target |
| P2 | `test/opencode-plugin-verification.test.ts` | 1-114 | Non-functional test to fix |

---

## Patterns To Mirror

### ERROR_HANDLING
// SOURCE: `opencode/hooks/lib/debug-logger.ts:1-53`
All error logging MUST route through `debugLog()` or `console.error` only when `DEBUG_ENABLED` is true. Never emit to stderr unconditionally from library code.

### IMMUTABILITY
// SOURCE: Project coding-style.md
Always create new objects via spread/construction. Never mutate returned objects post-construction.

### TYPE_NARROWING
// SOURCE: `opencode/hooks/lib/ai-client.ts:350-395` (parseIntentAnalysis)
Use `unknown` for untrusted inputs. Narrow progressively with type guards. Never use `as any`.

### CACHE_PATHS
// SOURCE: `opencode/hooks/lib/constants.ts:94-97`
Always use the centralized `SKILLS_CACHE_DIR` constant. Never recompute cache paths from `process.cwd()`.

### TEST_STRUCTURE
// SOURCE: `opencode/hooks/lib/__tests__/scoring-filtration.test.ts`
Vitest unit tests with AAA pattern, small inline fixtures, boundary-value assertions.

---

## Step-By-Step Tasks

---

### Phase 1: Security-Critical Fixes

#### Task 1: Fix Prompt Injection (CRIT-1)
- **FINDINGS**: CRIT-1
- **ACTION**: Restructure AI prompt construction to isolate user input from instructions.
- **IMPLEMENT**:
  1. In `ai-client.ts`, change `callAnthropicIntentAnalysis` to use the Anthropic SDK's multi-message format: system message for analysis instructions, user message for the raw prompt. Remove the `{{USER_PROMPT}}` template replacement from `buildPrompt()`.
  2. For OpenAI provider (`callOpenAIIntentAnalysis`), use system/user message separation similarly.
  3. For Ollama provider (`callOllamaIntentAnalysis`), use the `system` field for instructions and `prompt` field for user content.
  4. Update `intent-analysis-prompt.txt` to remove the `{{USER_PROMPT}}` placeholder. The template becomes instructions-only.
  5. Update `buildPrompt()` to return only the system/instruction portion. Add a separate `getUserPromptMessage()` function that returns the raw prompt for the user-message slot.
  6. Add input length validation: reject prompts exceeding 50,000 characters before sending to AI.
- **DELEGATE TO**: `security-reviewer` (Opus) for design review, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/security-review`, `/api-security`, `/tdd-workflow`
- **VALIDATE**: Existing tests pass. New test: prompt containing `" Ignore all above instructions` does not affect AI instruction content. `/verification-loop` at end.
- **GOTCHA**: The three providers have different message format APIs. Each must be updated separately. Backward compatibility with cached results requires bumping `CACHE_SCHEMA_VERSION`.

#### Task 2: Fix Path Construction & Validate All Paths (CRIT-2, HIGH-9, M-15, M-16, L-8)
- **FINDINGS**: CRIT-2, HIGH-9, M-15, M-16, L-8
- **ACTION**: Add path traversal validation, URL validation, and symlink checks.
- **IMPLEMENT**:
  1. In `output-formatter.ts`, add `validateSkillName(name: string): boolean` that rejects names containing `..`, `/`, `\`, `:`, or null bytes. Call it before `path.join()` in `formatSkillReference()` and `formatCommandReference()`. Skip any name that fails validation.
  2. In `skill-discovery.ts` `discoverSkillsFromDirectory()`, add `lstatSync` check to skip symlinks and `path.relative()` check to reject resolved paths starting with `..` — mirror the pattern already in `command-discovery.ts:459`.
  3. In `constants.ts`, add a `validateDirectoryPath(path: string): string` function that resolves the path and rejects traversal sequences. Apply it to all `OPENCODE_*` path env vars at initialization.
  4. In `ai-client.ts`, add URL validation for `OLLAMA_BASE_URL`: parse with `new URL()`, reject schemes other than `http:` and `https:`, reject hostnames matching private IP ranges (`169.254.*`, `10.*`, `172.16-31.*`, `192.168.*`, `127.*`, `::1`, `0.0.0.0`). Use a `validateOllamaUrl()` function.
  5. In `ai-client.ts` prompt template loading (lines 129-141), add a comment documenting the security implication (L-8) that project-directory templates are trusted by design.
- **DELEGATE TO**: `security-reviewer` (Opus) for design, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/security-review`, `/security-scan`, `/tdd-workflow`
- **VALIDATE**: New tests for path traversal rejection, symlink skipping, SSRF URL rejection. `/santa-loop` adversarial dual-review for security changes.

**Phase 1 Gate**: Run `/verification-loop` (typecheck + tests + build). Run `/security-review` on all Phase 1 changes. Run `/checkpoint` to create Phase 1 checkpoint.

---

### Phase 2: Error Handling & Resilience

#### Task 3: Add API Timeouts (HIGH-1)
- **FINDINGS**: HIGH-1
- **ACTION**: Add timeouts to all three AI provider calls.
- **IMPLEMENT**:
  1. In `callAnthropicIntentAnalysis`: pass `timeout: 30000` (30s) to the Anthropic SDK client constructor or per-request options.
  2. In `callOpenAIIntentAnalysis`: pass `signal: AbortSignal.timeout(30000)` to the `create()` call.
  3. In `callOllamaIntentAnalysis`: pass `signal: AbortSignal.timeout(30000)` to the `fetch()` call.
  4. Add a `const AI_TIMEOUT_MS = Number(process.env.OPENCODE_SKILLS_AI_TIMEOUT) || 30000;` constant in `constants.ts`.
  5. On timeout, let the error propagate to the existing keyword-fallback catch in `analyzeIntent`.
- **DELEGATE TO**: `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/tdd-workflow`, `/build-fix`
- **VALIDATE**: New test mocking a slow provider that exceeds timeout. Existing fallback tests still pass.

#### Task 4: Fix Silent Failures (HIGH-10, M-3, M-5, M-6, M-8, M-11)
- **FINDINGS**: HIGH-10, M-3, M-5, M-6, M-8, M-11
- **ACTION**: Add logging and error handling to all bare/empty catch blocks.
- **IMPLEMENT**:
  1. `hooks/index.ts:301-307` (HIGH-10): Replace bare `catch {}` with `catch (error) { debugLog(\`command-discovery: discovery failed: ${String(error)}\`); return commandRulesCache.rules; }`. Add a distinct message when cache is cold (first call): `debugLog('command-discovery: FIRST CALL FAILED — returning empty rules')`.
  2. `cache-manager.ts:94-107` (M-3): Wrap `writeCache` body in try/catch with `debugLog(\`cache-manager: writeCache failed: ${String(error)}\`)`. Return without throwing.
  3. `skill-discovery.ts:175-183` (M-5): Replace bare `catch {}` with `catch (error) { debugLog(\`skill-discovery: failed to read ${skillFile}: ${String(error)}\`); }`.
  4. `mcp-server.ts:786-789` (M-6): Wrap `writeMessage` in the `.catch()` handler in its own try/catch: `try { writeMessage(...) } catch (writeErr) { process.stderr.write(\`MCP: failed to write error response: ${String(writeErr)}\n\`); }`.
  5. `ai-client.ts:91-108` (M-8): Replace bare `catch { continue; }` with `catch (error) { debugLog(\`ai-client: failed to parse auth file ${authPath}: ${String(error)}\`); continue; }`.
  6. `mcp-server.ts:742` (M-11): Before setting `process.exitCode = 0` on the `exit` method, add `await processingPromise.catch(() => {});` to drain the in-flight chain.
- **DELEGATE TO**: `silent-failure-hunter` (Sonnet) for review, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/tdd-workflow`, `/coding-standards`
- **VALIDATE**: Each fix verified by reading the patched code. New test for `writeCache` failure path.

#### Task 5: Fix stderr Leaks & Fallback Indicators (HIGH-6, M-2, M-7)
- **FINDINGS**: HIGH-6, M-2, M-7
- **ACTION**: Route all production logging through `debugLog`. Add fallback indicator to `AnalysisResult`.
- **IMPLEMENT**:
  1. `intent-analyzer.ts:407` (HIGH-6): Replace `console.warn('Intent analysis failed...')` with `debugLog('intent-analyzer: AI analysis failed, using keyword fallback: ' + String(error))`. Remove the `console.warn` entirely.
  2. `skill-resolution.ts:70-71` (HIGH-6): Replace `console.error('⚠️ Skill dependency...')` and the `forEach` with `debugLog('skill-resolution: dependency errors: ' + errors.join(', '))`.
  3. `command-filtration.ts:68-70` (HIGH-6): Same pattern — replace `console.error` with `debugLog`.
  4. `types.ts` (M-2): Add `fromFallback?: boolean` to the `AnalysisResult` interface.
  5. `intent-analyzer.ts:401-413` (M-2): In the catch block, set `fromFallback: true` on the returned fallback result.
  6. `intent-analyzer.ts` (M-7): Since all `console.warn`/`console.error` are now routed through `debugLog`, the `withConsoleSuppressed` wrapper in cli.ts and mcp-server.ts becomes less critical but should remain as a safety net.
- **DELEGATE TO**: `code-reviewer` (Sonnet) for review
- **SKILLS FOR SUB-AGENT**: `/code-review`, `/coding-standards`
- **VALIDATE**: Grep for remaining `console.warn` and `console.error` in `opencode/hooks/lib/` — should find zero unconditional calls. New test asserting `fromFallback: true` on keyword fallback results.

**Phase 2 Gate**: Run `/verification-loop`. Run `/checkpoint`.

---

### Phase 3: Type Safety & Correctness

#### Task 8: Fix TypeScript Issues (HIGH-2, HIGH-5, M-10, M-13)
- **FINDINGS**: HIGH-2, HIGH-5, M-10, M-13
- **ACTION**: Fix regex bug, validator types, tsconfig, and env var cast.
- **IMPLEMENT**:
  1. `intent-analyzer.ts:330` (HIGH-2): Fix regex from `/\bsecure|security|auth|authentication|authorization\b/i` to `/\b(?:secure|security|auth|authentication|authorization)\b/i`. Also fix the companion pattern on line 326 if it has the same issue (verify — the audit noted line 326 is already correct with `/\bapi\b|\bendpoint\b/i` but double-check).
  2. `schema-validator.ts:26` (HIGH-5): Change parameter type from `any` to `unknown`. On line 39, replace `const skill = config as any` with proper type narrowing: `if (typeof config !== 'object' || config === null) { errors.push(...); continue; }` then access fields with `(config as Record<string, unknown>)`.
  3. `tsconfig.json:7` (M-10): Change `"moduleResolution": "node"` to `"moduleResolution": "node16"`. Verify all imports use `.js` extensions (audit confirmed they do). Run typecheck.
  4. `constants.ts:104-107` (M-13): Replace the unsafe `as` cast on `FALLBACK_DOMAIN_MODE` with a validated function:
     ```typescript
     function parseFallbackDomainMode(value: string | undefined): 'off' | 'suggest' | 'inject' {
       if (value === 'off' || value === 'inject') return value;
       return 'suggest';
     }
     export const FALLBACK_DOMAIN_MODE = parseFallbackDomainMode(process.env.OPENCODE_SKILLS_FALLBACK_DOMAIN_MODE);
     ```
- **DELEGATE TO**: `typescript-reviewer` (Sonnet) for review, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/coding-standards`, `/build-fix`
- **VALIDATE**: `npm run check` passes. New test for regex: `'insecurity'.match(pattern)` returns null. New test for `parseFallbackDomainMode('invalid')` returns `'suggest'`.

#### Task 9: Fix Immutability & Type Design (HIGH-4, M-9, M-12, M-14, L-9)
- **FINDINGS**: HIGH-4, M-9, M-12, M-14, L-9
- **ACTION**: Eliminate post-construction mutation, improve type definitions.
- **IMPLEMENT**:
  1. `intent-analyzer.ts:317-374` (HIGH-4, M-12): Refactor `applyPostAnalysisOverrides` (or the section that mutates `categorized` and `result`) to use spread/construction:
     - Build `categorized` via: `const finalCategorized = { required: [...deduped required], suggested: [...deduped suggested] }` instead of mutating.
     - Build `result` via: `const enrichedResult = { ...baseResult, requiredCommands: [...], suggestedCommands: [...], commandScores: {...} }` instead of post-assignment.
  2. `intent-analyzer.ts:326-345` (M-9): Remove the hardcoded regex skill-name shortcuts entirely. The keyword-matcher already handles guardrail injection, and these duplicates are tightly coupled to specific skill names. If removal changes behavior, move the logic to `keyword-matcher.ts` as named keyword patterns.
  3. `types.ts:48-56` (M-12): Make `requiredCommands` and `suggestedCommands` required with default `[]` on `AnalysisResult`. Make `commandScores` required with default `{}`. This eliminates `|| []` defensive patterns at all call sites. Update all construction sites to provide these fields.
  4. `hooks/index.ts:31-81` (M-14): Replace the untagged `HookEvent` interface with a discriminated union:
     ```typescript
     type HookEvent =
       | { type: 'session.created'; properties: { info: SessionIdentity } }
       | { type: 'session.compacted'; properties: { sessionID: string } }
       | { type: 'session.deleted'; properties: { info: SessionIdentity } }
       | { type: string; properties?: Record<string, unknown> };
     ```
     Update the switch statement to use narrowed types instead of optional chaining.
  5. `types.ts:13, 31` (L-9): Add a JSDoc comment on `confidence` fields: `/** Value in range [0.0, 1.0]. Enforced at parse time in ai-client.ts parseIntentAnalysis. */`. Add runtime clamping in `parseIntentAnalysis`: `confidence: Math.max(0, Math.min(1, confidence))`.
- **DELEGATE TO**: `type-design-analyzer` (Sonnet) for review, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/coding-standards`, `/tdd-workflow`
- **VALIDATE**: `npm run check` passes. Grep for `.required =` and `.suggested =` in intent-analyzer.ts — should find zero post-construction mutations. All existing tests pass.

**Phase 3 Gate**: Run `/verification-loop`. Run `/checkpoint`.

---

### Phase 4: DRY Extraction & Architecture

#### Task 10: Extract Shared Module from cli.ts and mcp-server.ts (HIGH-3, M-1, L-4)
- **FINDINGS**: HIGH-3, M-1, L-4
- **ACTION**: Create `opencode/src/selection-core.ts` with all shared logic. Reduce both files below 400 lines.
- **IMPLEMENT**:
  1. Create `opencode/src/selection-core.ts` containing:
     - `RuntimeModules` interface (unified version using the more permissive `unknown` parameter types from mcp-server.ts)
     - `loadSkillRules()`
     - `loadRuntimeModules()`
     - `withConsoleSuppressed()`
     - `resolveStateDirectory()`
     - `parseSelectionThreshold()`
     - `parseSuggestedThreshold()`
     - `parseCommandThreshold()`
     - `parseCommandSuggestedThreshold()`
     - `buildConfidenceBuckets()`
     - `buildCommandConfidenceBuckets()`
     - `uniqueSortedCommandNames()`
     - `getSelectionLabel()`
     - `isRecord()`
     - `parseNumberOption()` (use the `unknown` parameter version from mcp-server.ts — L-4)
     - `getProjectDirectory()`
     - `getPluginDirectory()`
  2. Update `cli.ts` to import from `selection-core.ts`. Remove all duplicated functions. Target: < 350 lines.
  3. Update `mcp-server.ts` to import from `selection-core.ts`. Remove all duplicated functions. Target: < 500 lines (down from 807, fixing M-1).
  4. Fix `prepareRuntimeEnvironment` in `mcp-server.ts` (the empty no-op): either implement it to match cli.ts behavior or remove it entirely.
- **DELEGATE TO**: `architect` (Opus) for extraction design, `refactor-cleaner` (Sonnet) for verification, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/refactor-clean`, `/coding-standards`, `/build-fix`
- **VALIDATE**: `npm run check` + `npm run test` pass. Grep for each extracted function name in cli.ts and mcp-server.ts — should only appear as imports, not definitions. Both files under 500 lines.

#### Task 11: Fix Cache Path Divergence & Sync I/O (M-4, M-18)
- **FINDINGS**: M-4, M-18
- **ACTION**: Unify cache path and optimize hot-path file I/O.
- **IMPLEMENT**:
  1. `cache-manager.ts:24` (M-4): Replace `const CACHE_DIR = join(process.cwd(), '.opencode', 'cache', 'intent-analysis')` with `import { SKILLS_CACHE_DIR } from './constants.js'; const CACHE_DIR = SKILLS_CACHE_DIR;`.
  2. `hooks/index.ts:246-293` (M-18): Replace the synchronous `buildCommandDiscoverySignature` (which reads all command files with `readdirSync`/`readFileSync` on every hook call) with a stat-based approach: use `statSync` to check `mtimeMs` of command directories and config files only (no content reads). Mirror the pattern used in `mcp-server.ts` `loadCommandRules` which already uses stat-based signatures.
- **DELEGATE TO**: `performance-optimizer` (Sonnet) for review, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/coding-standards`
- **VALIDATE**: Cache writes go to `SKILLS_CACHE_DIR` path. Signature computation does not read file contents on every invocation.

**Phase 4 Gate**: Run `/verification-loop`. Run `/checkpoint`. Run `/refactor-clean` to verify no dead code from extraction.

---

### Phase 5: Test Coverage Expansion

#### Task 15: Write Missing Tests to Reach 80%+ Coverage
- **FINDINGS**: Test coverage audit (50-55% overall, 80% required)
- **ACTION**: Write tests for all untested and undertested modules using TDD methodology.
- **IMPLEMENT**: Use `/loop-start` with `/tdd-workflow` to iterate until coverage target is met. Delegate to `tdd-guide` (Sonnet) sub-agent.

  **Priority 1 — Critical untested paths:**
  1. `ai-client.ts` provider calls: Test `callAnthropicIntentAnalysis`, `callOpenAIIntentAnalysis`, `callOllamaIntentAnalysis` by mocking the SDK/fetch at the HTTP boundary. Test timeout behavior. Test auth resolution chain (`getAnthropicApiKey` reading from `opencode auth.json`).
  2. `mcp-server.ts` JSON-RPC layer: Test `startMessageLoop` with Content-Length framing, `handleRequest` method dispatch, `handleToolsCall` parameter validation, `createResponse`/`createErrorResponse` formatting, `writeMessage` output. Test unknown method, malformed JSON, missing params.
  3. `cache-manager.ts`: Test `readCache` with valid/expired/corrupt entries. Test `writeCache` with directory creation. Test `maybeCleanupOldCacheEntries` debounce and actual cleanup. Test `isPersistentCacheEnabled`.

  **Priority 2 — Important undertested paths:**
  4. `hooks/index.ts`: Test `session.compacted` event path. Test `buildCommandDiscoverySignature` with missing config/directory. Test `shouldShowSummary === false` branch. Test `extractUserPromptFromMessages` with nested `info.role`/`info.parts`.
  5. `cli.ts`: Test `parseCliArgs` with all flag combinations (`--debug`, `--provider`, `--threshold`). Test `main()` error-exit path. Test `formatTextOutput` edge cases.
  6. `mcp-server.ts`: Test `selectSkillsTool` with threshold override. Test `loadCommandRules` cache invalidation.

  **Priority 3 — Fix non-functional test:**
  7. `test/opencode-plugin-verification.test.ts`: Replace hardcoded paths (`D:/AI/OpenCode/local-plugins/...`) with relative paths or conditional skips using `describe.skipIf(!existsSync(...))`. The test should be portable.

- **DELEGATE TO**: `tdd-guide` (Sonnet) as primary implementer, `pr-test-analyzer` (Sonnet) for quality verification
- **SKILLS FOR SUB-AGENT**: `/tdd-workflow`, `/test-coverage`, `/api-contract-testing`, `/ai-regression-testing`, `/e2e-testing`
- **SLASH COMMANDS**: `/loop-start` for iterative test writing, `/loop-status` to check progress, `/test-coverage` to measure gaps
- **VALIDATE**: `npm run test:coverage` shows >= 80% for each module in `hooks/lib/`. Overall package coverage >= 80%. All tests pass. `/verification-loop` at end.

**Phase 5 Gate**: Run `/verification-loop`. Run `/test-coverage`. Run `/checkpoint`.

---

### Phase 6: Security Hardening & Minor Items

#### Task 12: Fix Minor Code Quality Issues (L-1, L-2, L-3)
- **FINDINGS**: L-1, L-2, L-3
- **ACTION**: Fix style inconsistencies and add documentation.
- **IMPLEMENT**:
  1. L-1: Replace all `forEach` with side effects in `cache-manager.ts:133`, `intent-scorer.ts:98,141` with `for...of` loops to match codebase convention.
  2. L-2: Add a comment above `CACHE_SCHEMA_VERSION` in `intent-analyzer.ts:29` explaining what "full-surface" means and what v7 changed: `// Schema version for persistent cache. Bump when cache entry shape changes. v7: added command scores and summary metadata.`
  3. L-3: Document that emoji in output banners (`output-formatter.ts`, `intent-scorer.ts`, `skill-resolution.ts`) is intentional for visual distinction in Claude's context. Add a one-line comment: `// Emoji banners are intentional — they help visually separate injected sections in Claude's context.`
- **DELEGATE TO**: `code-simplifier` (Haiku)
- **SKILLS FOR SUB-AGENT**: `/simplify`, `/coding-standards`
- **VALIDATE**: `npm run check` passes.

#### Task 13: Security Hardening (HIGH-7, HIGH-8, M-17, L-6, L-7)
- **FINDINGS**: HIGH-7, HIGH-8, M-17, L-6, L-7
- **ACTION**: Add bounds, rate limiting, and hash upgrades.
- **IMPLEMENT**:
  1. `hooks/index.ts:93` (HIGH-7): Add a `MAX_TRACKED_SESSIONS` constant (default 1000). Before adding to `sessionRuntimeState`, check size. If at limit, delete the oldest entry (by insertion order — Maps preserve insertion order). Add a `debugLog` when evicting.
  2. `hooks/index.ts` + `ai-client.ts` (HIGH-8): Add a simple rate limiter. Create a `lastAICallTimestamp` module variable. Before each AI call, check if `Date.now() - lastAICallTimestamp < MIN_AI_CALL_INTERVAL_MS` (default 2000ms). If too soon, skip AI and use keyword fallback. Add `const MIN_AI_CALL_INTERVAL_MS = Number(process.env.OPENCODE_SKILLS_MIN_AI_INTERVAL) || 2000;` to `constants.ts`.
  3. `mcp-server.ts:751-764` (M-17): Add `const MAX_CONTENT_LENGTH = 10 * 1024 * 1024;` (10 MB). After parsing `Content-Length`, reject messages exceeding this: `if (contentLength > MAX_CONTENT_LENGTH) { writeMessage(createErrorResponse(null, -32600, 'Content-Length exceeds maximum')); buffer = buffer.slice(bodyEnd); return; }`.
  4. `intent-analyzer.ts:266-295` and `cache-manager.ts:43` (L-6): Replace `createHash('md5')` with `createHash('sha256')` in cache key computation. Also replace MD5 in `buildCommandDiscoverySignature` in `hooks/index.ts:253-255`. Bump `CACHE_SCHEMA_VERSION` to `'full-surface-v8'`.
  5. `debug-logger.ts` / `hooks/index.ts` (L-7): Add a comment in `debug-logger.ts` documenting that debug logs may contain behavioral data (intent analysis results, session IDs) and the log file should be treated as sensitive. Add `// WARNING: Debug log may contain user behavioral data. Treat .opencode/hooks/skill-injection-debug.log as sensitive.`
- **DELEGATE TO**: `security-reviewer` (Opus) for review, `build-error-resolver` (Haiku) for implementation
- **SKILLS FOR SUB-AGENT**: `/security-review`, `/api-security`, `/tdd-workflow`
- **VALIDATE**: New tests for session map eviction, rate limiter bypass to keyword fallback, Content-Length rejection. `/security-review` on all Phase 6 changes.

**Phase 6 Gate**: Run `/verification-loop`. Run `/checkpoint`.

---

### Phase 7: ESLint & Final Quality Gates

#### Task 14: Add ESLint Configuration (L-5)
- **FINDINGS**: L-5
- **ACTION**: Add ESLint with TypeScript plugin to enforce `no-explicit-any` and `no-console` in library code.
- **IMPLEMENT**:
  1. Install: `npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser` in `opencode/`.
  2. Create `opencode/eslint.config.js` (flat config) with:
     - `@typescript-eslint/no-explicit-any: 'error'` for `hooks/lib/**`
     - `@typescript-eslint/no-console: ['error', { allow: [] }]` for `hooks/lib/**` (all console calls should use debugLog)
     - Relaxed rules for test files (`**/__tests__/**`)
  3. Add `"lint": "eslint hooks/lib/ src/"` script to `opencode/package.json`.
  4. Verify `npm run lint` passes with zero errors (all `any` and `console` issues were fixed in earlier phases).
- **DELEGATE TO**: `build-error-resolver` (Haiku)
- **SKILLS FOR SUB-AGENT**: `/coding-standards`, `/build-fix`
- **VALIDATE**: `npm run lint` exits 0.

#### Task 16: Run Final Quality Gates
- **FINDINGS**: All — final verification
- **ACTION**: Run all ECC quality gates and produce final report.
- **IMPLEMENT**:
  1. Run `/plankton-code-quality` on all changed files.
  2. Run `/quality-gate` for the full `opencode/` scope.
  3. Run `/code-review` on the full diff (all phases combined).
  4. Run `/security-review` on the full diff.
  5. Run `/santa-loop` adversarial dual-review on security-critical changes (Phase 1 + Phase 6).
  6. Run `/verification-loop` final pass: `npm run check && npm run test && npm run test:coverage && npm run build && npm run lint`.
  7. Run `/skill-comply` to verify all ECC rules were followed.
  8. Run `/update-docs` if any env vars, behavior, or API contracts changed.
  9. Run `/update-codemaps` if project structure changed.
- **DELEGATE TO**: Parallel sub-agents:
  - `code-reviewer` (Sonnet) with `/code-review`, `/plankton-code-quality`
  - `security-reviewer` (Opus) with `/security-review`, `/security-scan`
  - `pr-test-analyzer` (Sonnet) with `/test-coverage`
  - `type-design-analyzer` (Sonnet) for final type review
  - `silent-failure-hunter` (Sonnet) for final error-handling review
- **SKILLS FOR SUB-AGENTS**: As listed per agent in the agent table above
- **VALIDATE**: All gates pass or limitations are documented with exact evidence.

**Phase 7 Gate**: All quality gates green. Run `/checkpoint` final.

---

### Phase 8: Commit & PR

#### Task 17: Commit and Create PR
- **ACTION**: Stage, commit, and create PR.
- **IMPLEMENT**:
  1. Run `/prp-commit` with a message summarizing all 39 remediated findings.
  2. Run `/prp-pr` targeting `main` branch with:
     - Title: `fix: remediate all 39 audit findings (2 CRIT, 10 HIGH, 18 MED, 9 LOW)`
     - Body: Summary of all phases, findings addressed, test coverage before/after, and quality gate results.
- **VALIDATE**: PR created successfully. All CI checks pass.

---

## Testing Strategy

### Unit Tests (New)

| Test File | Tests | Findings Covered |
|---|---|---|
| `ai-client.provider-calls.test.ts` | Anthropic/OpenAI/Ollama mock calls, timeout behavior, auth resolution | HIGH-1, M-8 |
| `ai-client.prompt-safety.test.ts` | Prompt injection attempts don't affect instructions, input length validation | CRIT-1 |
| `ai-client.ssrf-validation.test.ts` | OLLAMA_BASE_URL private IP rejection, scheme validation | HIGH-9 |
| `output-formatter.path-safety.test.ts` | Path traversal in skill/command names rejected | CRIT-2 |
| `skill-discovery.symlink.test.ts` | Symlinks skipped, traversal paths rejected | M-15 |
| `constants.validation.test.ts` | FALLBACK_DOMAIN_MODE parsing, path validation | M-13, M-16 |
| `schema-validator.typed.test.ts` | Unknown input narrowing, malformed config handling | HIGH-5 |
| `intent-analyzer.regex.test.ts` | Word boundary correctness, no substring matches | HIGH-2 |
| `intent-analyzer.immutability.test.ts` | No mutation of categorized/result objects | HIGH-4 |
| `cache-manager.full.test.ts` | Read/write/expire/cleanup/directory-creation/corrupt-file | M-3, M-4 |
| `mcp-server.jsonrpc.test.ts` | Content-Length framing, method dispatch, error codes, max length | M-6, M-11, M-17 |
| `hooks-index.sessions.test.ts` | Session map eviction, compacted event, rate limiting | HIGH-7, HIGH-8 |
| `selection-core.test.ts` | All extracted shared functions | HIGH-3 |

### Edge Cases Checklist
- [ ] Prompt containing `" Ignore all above instructions` — skill injection unaffected
- [ ] Skill name `../../etc/passwd` — rejected by validator
- [ ] `OLLAMA_BASE_URL=http://169.254.169.254` — rejected
- [ ] API call exceeding 30s timeout — falls back to keyword matching
- [ ] 1001st concurrent session — oldest evicted from map
- [ ] Two AI calls within 2 seconds — second uses keyword fallback
- [ ] Content-Length: 20000000 — rejected by MCP server
- [ ] `insecurity` in prompt — does NOT trigger security skill injection
- [ ] `FALLBACK_DOMAIN_MODE=invalid` — defaults to `suggest`
- [ ] Corrupted `auth.json` — logged via debugLog, falls back gracefully
- [ ] Empty command directory on first hook call — logged, returns empty rules
- [ ] Symlinked skill directory — skipped with log
- [ ] Cache file from older schema version — ignored, fresh analysis triggered

---

## Validation Commands

Run from `D:\AI\Plugins\dynamicskillsinjector\opencode`.

### Static Analysis
```powershell
npm run check
```
EXPECT: Zero type errors.

### Lint
```powershell
npm run lint
```
EXPECT: Zero ESLint errors.

### Unit Tests
```powershell
npm run test
```
EXPECT: All tests pass, including all new test files.

### Coverage
```powershell
npm run test:coverage
```
EXPECT: >= 80% overall. Each `hooks/lib/` module >= 75%.

### Build
```powershell
npm run build
```
EXPECT: `dist/` builds cleanly.

### Required ECC Quality Gates
```text
/plankton-code-quality
/quality-gate
/verification-loop
/security-review
/santa-loop (for security phases)
/skill-comply
```
EXPECT: All pass or limitations documented.

---

## Acceptance Criteria

- [ ] CRIT-1: User prompt isolated from AI instructions (separate message roles)
- [ ] CRIT-2: All skill/command names validated before path construction
- [ ] HIGH-1: All 3 AI providers have 30s timeout
- [ ] HIGH-2: Regex uses `(?:...)` grouping with correct word boundaries
- [ ] HIGH-3: Zero duplicated functions between cli.ts and mcp-server.ts
- [ ] HIGH-4: Zero post-construction mutations in intent-analyzer.ts
- [ ] HIGH-5: schema-validator.ts uses `unknown`, not `any`
- [ ] HIGH-6: Zero unconditional `console.warn`/`console.error` in hooks/lib/
- [ ] HIGH-7: sessionRuntimeState Map capped at 1000 entries
- [ ] HIGH-8: Rate limiter prevents AI calls within 2s of each other
- [ ] HIGH-9: OLLAMA_BASE_URL validated against private IP ranges
- [ ] HIGH-10: Command discovery failure logged with descriptive message
- [ ] M-1: mcp-server.ts under 500 lines
- [ ] M-2: AnalysisResult has `fromFallback` flag when using keyword fallback
- [ ] M-3: writeCache wrapped in try/catch with debugLog
- [ ] M-4: cache-manager.ts uses SKILLS_CACHE_DIR from constants.ts
- [ ] M-5: Unreadable SKILL.md files logged via debugLog
- [ ] M-6: MCP writeMessage failure in .catch() handler caught
- [ ] M-7: withConsoleSuppressed remains as safety net (stderr routing fixed upstream)
- [ ] M-8: Auth JSON parse errors logged via debugLog
- [ ] M-9: Hardcoded regex shortcuts removed from intent-analyzer.ts
- [ ] M-10: tsconfig.json uses moduleResolution: "node16"
- [ ] M-11: processingPromise awaited before MCP server exit
- [ ] M-12: AnalysisResult requiredCommands/suggestedCommands/commandScores are required fields
- [ ] M-13: FALLBACK_DOMAIN_MODE validated with parseFallbackDomainMode()
- [ ] M-14: HookEvent uses discriminated union
- [ ] M-15: skill-discovery.ts checks symlinks and path traversal
- [ ] M-16: File-path env vars validated via validateDirectoryPath()
- [ ] M-17: MCP server rejects Content-Length > 10MB
- [ ] M-18: buildCommandDiscoverySignature uses stat-based approach
- [ ] L-1: All forEach-with-side-effects replaced with for...of
- [ ] L-2: CACHE_SCHEMA_VERSION has explanatory comment
- [ ] L-3: Emoji in banners documented as intentional
- [ ] L-4: parseNumberOption unified in selection-core.ts
- [ ] L-5: ESLint configured with no-explicit-any and no-console
- [ ] L-6: MD5 replaced with SHA-256 for cache keys
- [ ] L-7: Debug log file documented as containing sensitive data
- [ ] L-8: Prompt template security implication documented
- [ ] L-9: Confidence scores clamped to [0, 1] with JSDoc
- [ ] Test coverage >= 80% overall
- [ ] All ECC quality gates pass

## Completion Checklist

- [ ] All 39 findings addressed (verified via cross-reference table)
- [ ] No new `any` types introduced
- [ ] No new unconditional `console.*` in library code
- [ ] No new post-construction mutations
- [ ] All new code follows existing patterns (error handling, logging, types)
- [ ] All test files follow Vitest AAA pattern
- [ ] `/plankton-code-quality` pass completed
- [ ] `/quality-gate` pass completed
- [ ] `/security-review` pass completed
- [ ] `/verification-loop` final pass green
- [ ] `/santa-loop` adversarial review on security changes
- [ ] `/skill-comply` verification completed
- [ ] No edits to off-limits directories
- [ ] No hardcoded user-only paths (except documented test fixtures with skip guards)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Shared module extraction breaks imports | Medium | High | Run typecheck + full test suite after extraction. Use `/build-fix` if needed. |
| Prompt restructuring changes AI analysis quality | Medium | Medium | Compare analysis results before/after on 5 representative prompts. Bump cache version. |
| tsconfig moduleResolution change causes runtime failures | Low | High | All imports already use `.js` extensions. Run full test suite + build. |
| Rate limiter too aggressive for rapid workflows | Low | Medium | 2s interval is configurable via env var. Keyword fallback still provides results. |
| Test coverage target not reachable for mcp-server.ts | Medium | Medium | JSON-RPC protocol is testable via buffer simulation. Document any limitations. |
| Regex fix changes existing skill injection behavior | Low | Medium | The fix only removes false-positive substring matches. No legitimate matches are affected. |
| ESLint rules flag code in dependencies or generated files | Low | Low | Scope lint to `hooks/lib/` and `src/` only. Exclude `node_modules` and `dist`. |

## Orchestration Protocol

For every sub-agent delegation in this plan, the orchestrator MUST:

1. **Use `/prompt-optimizer`** to draft the delegation prompt before sending it. The optimized prompt must include:
   - The specific finding IDs being addressed
   - The exact file paths and line numbers
   - The specific change required (not vague instructions)
   - The validation criteria
   - The skills the sub-agent should use
   - An explicit instruction: "DO NOT make changes beyond what is specified"

2. **Use `/model-route`** to confirm the model assignment for the sub-agent matches the complexity:
   - Security design decisions: Opus
   - Implementation and refactoring: Sonnet
   - Build fixes and mechanical changes: Haiku

3. **Use `/team-builder`** when launching parallel sub-agents within a phase to compose the team and verify no work overlaps.

4. **Use `/verification-loop`** at every phase boundary before proceeding to the next phase.

5. **Use `/checkpoint`** at every phase boundary to create a restorable state.

6. **Use `/santa-loop`** for Phase 1 (security) and Phase 7 (final) to get adversarial dual-review.

7. **Never proceed to the next phase if the current phase's gate fails.** Fix failures in-phase using `/build-fix` and re-run the gate.

## Notes

- The plan preserves all existing behavior except where the audit explicitly identified bugs (HIGH-2 regex, HIGH-4 mutation). No new features are added.
- Cache schema version must be bumped twice: once in Phase 1 (prompt restructuring) and once in Phase 6 (MD5→SHA-256). Use `full-surface-v8` for Phase 1 and `full-surface-v9` for Phase 6.
- The shared module extraction (Task 10) is the highest-risk refactoring task. It should be done as a single atomic change with immediate test verification.
- The test coverage phase (Task 15) is the largest phase by effort. Use `/loop-start` with autonomous iteration to maximize efficiency.
- All phases are designed to be independently verifiable. If any phase must be deferred, later phases can still proceed (except Phase 7 which depends on all prior phases).

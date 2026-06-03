---
title: "workflow visuals – QA Report"
phase: QA
date: "2026-06-03 16:25:28"
owner: "timbo"
parent_execute: ".artifacts/execute/2026-06-03_16-01-51_workflow-visuals.md"
git_commit_at_qa: "b0765c0"
tags: [qa, workflow-visuals]
---

## Summary

| Metric | Count |
|--------|-------|
| Files reviewed | 13 |
| Functions/classes/interfaces reviewed | 39 |
| CRITICAL findings | 0 |
| WARNING findings | 3 |
| INFO findings | 4 |
| PASS (no issues) | 32 |

QA was read-only for source code. The only written artifact is this report.

## Changed Areas Reviewed

### File: `src/types.ts`

| Function/Class/Interface | Lines | Status |
|--------------------------|-------|--------|
| `WorkflowRunStats` | 11-17 | ✅ PASS |
| `WorkflowRunOptions` | 19-21 | ✅ PASS |
| `WorkflowLaneItemStatus` | 24 | ✅ PASS |
| `WorkflowProgressEvent` | 26-37 | ✅ PASS |
| `WorkflowApi.progress()` | 58-81 | ✅ PASS |

No contract mismatch found for the new internal workflow API. The API is additive, so existing workflows need recompilation only if they structurally implement `WorkflowApi` outside the engine.

### File: `src/progress.ts`

| Function/Class | Lines | Status |
|----------------|-------|--------|
| Snapshot interfaces | 7-50 | ✅ PASS |
| `ProgressTracker` state | 89-110 | ✅ PASS |
| `phase()` / `log()` | 121-133 | ✅ PASS |
| `event()` | 135-167 | ✅ PASS |
| `agentQueued()` / `agentStart()` / `agentTool()` / `agentDone()` / `agentFailed()` | 169-220 | ✅ PASS |
| `snapshot()` | 222-237 | ✅ PASS |
| `render()` / `publishStatus()` / `ensureWidget()` | 280-310 | ⚠️ WARNING |
| timer lifecycle / `done()` | 313-338 | ✅ PASS |
| `lines()` | 262-278 | ℹ️ INFO |

#### Findings

| Severity | Category | Finding | Recommendation |
|----------|----------|---------|----------------|
| WARNING | UI/Theming | `ensureWidget()` captures the `theme` passed to the widget factory and `invalidate()` only invalidates cached lines. If Pi changes theme while a workflow is active, the widget may continue rendering with the old theme because it is not re-registered with a fresh callback theme. This also diverges from the planned pi-subagents invalidation pattern. | On a follow-up, re-register the widget on invalidate or otherwise reacquire the current theme before rendering. |
| INFO | Maintainability | Private `lines()` is no longer used after moving to callback widgets. | Consider removing or using it only as an intentional fallback in a follow-up cleanup. |

### File: `src/ui/workflow-format.ts`

| Function | Lines | Status |
|----------|-------|--------|
| `formatDuration()` | 9-23 | ✅ PASS |
| `formatCount()` | 25-32 | ✅ PASS |
| `statusIcon()` | 34-50 | ✅ PASS |
| `badge()` | 52-54 | ✅ PASS |
| `truncateDisplay()` | 56-59 | ✅ PASS |
| `statusText()` | 61-77 | ✅ PASS |

Inputs are bounded and width-sensitive helpers use `truncateToWidth`. Elapsed time uses wall-clock `Date.now()` indirectly via callers; acceptable for visual display, but not monotonic.

### File: `src/ui/workflow-widget.ts`

| Function/Class | Lines | Status |
|----------------|-------|--------|
| `createWorkflowWidget()` | 14-16 | ✅ PASS |
| `renderWorkflowWidgetLines()` | 18-59 | ✅ PASS |
| `LiveWorkflowWidget` | 61-99 | ✅ PASS |
| `prioritizedBodyLines()` / `phaseLines()` / `agentLine()` / `footerLine()` | 101-143 | ✅ PASS |

Line count is capped at 12 and every returned line is truncated to width. State mutation is isolated to widget cache/frame state.

### File: `src/ui/workflow-result-renderer.ts`

| Function/Interface | Lines | Status |
|--------------------|-------|--------|
| result/finding interfaces | 5-25 | ✅ PASS |
| `isWorkflowResult()` | 27-30 | ✅ PASS |
| `isFinding()` | 32-41 | ✅ PASS |
| `isCodeReviewResult()` | 43-49 | ✅ PASS |
| `renderWorkflowResult()` / `renderWorkflowResultText()` | 51-62 | ✅ PASS |
| `renderCodeReviewResult()` / `renderFinding()` | 64-100 | ✅ PASS |
| generic/stats/JSON helpers | 102-149 | ✅ PASS |

Structural guards correctly reject malformed required fields. Generic fallback avoids throwing on ordinary non-code-review results; circular values are caught in expanded generic rendering.

### File: `src/ui/workflow-inspector.ts`

| Function/Class | Lines | Status |
|----------------|-------|--------|
| `WorkflowInspector` state/constructor | 16-26 | ✅ PASS |
| `handleInput()` | 28-60 | ✅ PASS |
| `render()` | 62-98 | ✅ PASS |
| section helpers | 102-178 | ✅ PASS |
| agent/finding/log helpers | 180-242 | ℹ️ INFO |
| `padRight()` | 245-248 | ✅ PASS |

#### Findings

| Severity | Category | Finding | Recommendation |
|----------|----------|---------|----------------|
| INFO | Edge Cases | Selection indexes are not clamped during render when live snapshot sections shrink. This can make the footer show a stale selected index and make Enter do nothing until the user navigates. | Clamp selected indexes against current selectable counts during render or before `selectedKey()` in a follow-up. |

### File: `src/engine.ts`

| Function | Lines | Status |
|----------|-------|--------|
| `runWorkflow()` | 16-60 | ✅ PASS |

The inspector launch is non-blocking (`void ctx.ui.custom(...)`) and gated by `options.inspect && ctx.hasUI`. `progress.done()` remains in `finally`, preserving cleanup on workflow errors.

### File: `src/agent-runner.ts`

| Function | Lines | Status |
|----------|-------|--------|
| `runAgent()` progress lifecycle changes | 49-122 | ⚠️ WARNING |

#### Findings

| Severity | Category | Finding | Recommendation |
|----------|----------|---------|----------------|
| WARNING | Error Handling | `createAgentSession()` and `session.subscribe()` run before the `try` block at lines 101-120. If session creation/subscription fails, the queued row has already moved to `running` but `agentFailed()` is never called and no session cleanup path runs. This misses the planned “render failed agents before rethrowing” behavior for pre-prompt failures. | In a follow-up, wrap session creation/subscription in the same guarded lifecycle, using nullable `session`/`unsubscribe` cleanup and marking the row failed before rethrow. |

### File: `src/index.ts`

| Function/Public Surface | Lines | Status |
|-------------------------|-------|--------|
| `summarize()` / `formatReport()` / `workflowEnvelope()` | 13-26 | ✅ PASS |
| `parseWorkflowInvocation()` | 34-42 | ✅ PASS |
| `pickWorkflow()` | 44-57 | ✅ PASS |
| `sendWorkflowResult()` | 59-72 | ✅ PASS |
| `registerMessageRenderer("workflow-result")` | 74-79 | ✅ PASS |
| `/workflow` command handler | 81-103 | ✅ PASS |
| `workflow` tool renderers/execute | 105-140 | ✅ PASS |

Direct invocation remains supported, unknown workflow errors still include available names, and non-interactive no-name usage remains a warning. `--inspect` is now reserved syntax in direct workflow args.

### File: `workflows/code-review.ts`

| Function/Contract | Lines | Status |
|-------------------|-------|--------|
| `ReportSchema` evidence/failure fields | 35-48 | ✅ PASS |
| stats/progress initialization in `run()` | 117-129 | ✅ PASS |
| scope progress and early returns | 131-164 | ✅ PASS |
| finder candidate/dropped progress | 201-239 | ✅ PASS |
| verifier verdict lanes/counters | 241-273 | ✅ PASS |
| final stats and synthesis result shape | 276-317 | ✅ PASS |
| helper functions `formatLocation()`, `verdictLane()`, `verdictStatus()`, `sameFinding()` | 320-348 | ✅ PASS |

Stats include at least `{ files, candidates, verified, kept }` on all observed return paths. Prompt bounding and changed-line gating logic were preserved.

### File: `scripts/test-workflow-ui.ts`

| Area | Lines | Status |
|------|-------|--------|
| Theme fixture | 8-64 | ✅ PASS |
| formatting/truncation tests | 66-80 | ✅ PASS |
| result guard/rendering tests | 82-111 | ⚠️ WARNING |

#### Findings

| Severity | Category | Finding | Recommendation |
|----------|----------|---------|----------------|
| WARNING | Test Coverage | Tests cover pure formatting and result rendering, but not the more failure-prone live surfaces: `ProgressTracker` widget lifecycle, theme invalidation, `runAgent()` pre-prompt failures, inspector launch/navigation, and `/workflow` invocation parsing. | Add no-LLM tests with fake `ctx.ui`/TUI objects and direct helper exports where needed. |

### File: `scripts/smoke.ts`

| Area | Lines | Status |
|------|-------|--------|
| UI module import smoke coverage | 5-8 | ✅ PASS |
| workflow discovery smoke | 10-18 | ✅ PASS |

### File: `package.json`

| Area | Lines | Status |
|------|-------|--------|
| `test:ui` script | 17-20 | ✅ PASS |

No dependency changes were introduced.

## Test Coverage Analysis

| Function/Area | Has Tests | Coverage % | Missing Cases |
|---------------|-----------|------------|---------------|
| `formatDuration()` | ✅ | Not measured | Negative/NaN covered by implementation but not asserted |
| `formatCount()` | ✅ | Not measured | Negative and huge values |
| `truncateDisplay()` | ✅ | Not measured | ANSI-colored truncation |
| `isCodeReviewResult()` / `isFinding()` | ✅ | Not measured | Optional field malformed cases, invalid stats values |
| `renderWorkflowResultText()` | ✅ | Not measured | Generic fallback, no findings, multiple findings collapse behavior |
| `renderWorkflowWidgetLines()` | ❌ | Not measured | Running/queued/failed/overflow/theme invalidation cases |
| `ProgressTracker` lifecycle | ❌ | Not measured | queued→running→done/failed, done cleanup, status de-duplication |
| `WorkflowInspector` | ❌ | Not measured | key handling, dynamic shrink, expanded details, line width invariants |
| `/workflow` command parsing/picker | ❌ | Not measured | `--inspect`, no args UI/non-UI, unknown workflow |
| `runAgent()` failure lifecycle | ❌ | Not measured | pre-prompt errors and prompt errors |
| `workflows/code-review.ts` progress stats | ❌ | Not measured | no-scope/no-files/no-survivors/report paths |

## Contract/API Verification

| Surface | Schema Match | Breaking Changes |
|---------|--------------|------------------|
| `WorkflowApi.progress(event)` | ✅ additive internal API | Existing built-in workflows compile; external custom workflows typed against `WorkflowApi` may need to accept added property structurally only if constructing API themselves. |
| `WorkflowProgressEvent` | ✅ discriminated union matches plan | None observed. |
| `WorkflowRunOptions.inspect` | ✅ optional | None. |
| `/workflow <name> [args]` | ✅ direct usage preserved | `--inspect` is now interpreted as an option in direct args. |
| `workflow` tool result details | ✅ envelope `{ name, result, completedAt }` for renderer | Tool `details` shape changed from raw result to envelope; content remains summary text for model context. |
| `code-review` result stats | ✅ includes `{ files, candidates, verified, kept }` | Stats shape expanded with `dropped`. |

## Static Analysis Summary

| Tool | Result |
|------|--------|
| `bun run typecheck` | PASS (`tsc --noEmit`) |
| `bun scripts/test-workflow-ui.ts && bun scripts/smoke.ts` | PASS |
| `npm audit --json` | Not available: failed with `ENOLOCK` because the repo has no npm lockfile |
| `rg "as any" src workflows scripts` | PASS: no matches in changed code |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation Status |
|------|------------|--------|-------------------|
| Active workflow widget keeps old colors after theme switch | Medium | Low | Not mitigated |
| Agent row not marked failed if session creation fails before prompt | Low | Medium | Not mitigated |
| UI regressions in picker/inspector/progress lifecycle due missing tests | Medium | Medium | Partially mitigated by typecheck and smoke imports |
| Wall-clock elapsed time can jump if system clock changes | Low | Low | Acceptable for display-only timing |

## Recommendations Summary

### Must Fix (CRITICAL)

None.

### Should Fix (WARNING)

1. Rework workflow widget invalidation so active widgets receive fresh theme state after theme changes.
2. Extend `runAgent()` failure lifecycle to cover `createAgentSession()` and subscription failures.
3. Add no-LLM tests around progress tracker lifecycle, widget/inspector rendering, command parsing, and `runAgent()` failure paths.

### Observations (INFO)

1. `ProgressTracker.lines()` appears dead after the callback widget refactor.
2. `WorkflowInspector` should clamp selected indexes when live sections shrink.
3. `npm audit` cannot run without a lockfile; this is existing repository setup, not introduced by the workflow UI work.
4. Elapsed-time display uses wall-clock `Date.now()`; acceptable for UI display but not monotonic timing.

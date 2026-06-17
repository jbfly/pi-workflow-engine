# Plan 001: Add workflow-level usage and cost reporting for Dynamax runs

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ce8357d..HEAD -- .pi/extensions/pi-workflow-engine/src/agent-runner.ts .pi/extensions/pi-workflow-engine/src/engine.ts .pi/extensions/pi-workflow-engine/src/types.ts .pi/extensions/pi-workflow-engine/index.ts .pi/extensions/pi-workflow-engine/src/ui/workflow-result-renderer.ts tests README.md USAGE.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug / dx
- **Planned at**: commit `ce8357d`, 2026-06-16

## Why this matters

Dynamax workflows spend real model tokens in subagents, but those subagents run in isolated in-memory pi sessions and their assistant `usage` is discarded when the sessions are disposed. Pi's built-in footer and `/session` stats only sum assistant usage in the host session, so users currently see an underreported cost for workflow-heavy tasks. This plan adds first-class workflow-level usage/cost aggregation inside `pi-workflow-engine` and surfaces it in workflow results without changing pi core or misusing host-session context accounting.

## Current state

Relevant files and roles:

- `.pi/extensions/pi-workflow-engine/src/agent-runner.ts` — creates one in-memory pi `AgentSession` per workflow `agent()` call and disposes it.
- `.pi/extensions/pi-workflow-engine/src/engine.ts` — creates the per-run `RunContext` and threads it through top-level and sub-workflows.
- `.pi/extensions/pi-workflow-engine/src/types.ts` — defines `WorkflowRunOptions`, `WorkflowApi`, and `AgentOptions`.
- `.pi/extensions/pi-workflow-engine/index.ts` — registers `/workflow`, the `workflow` tool, and result envelopes/rendering inputs.
- `.pi/extensions/pi-workflow-engine/src/ui/workflow-result-renderer.ts` — renders workflow result details in the TUI.
- `tests/agent-runner-perf.test.ts`, `tests/workflow-perf.test.ts`, `tests/sub-workflow.test.ts`, `tests/workflow-ui.test.ts`, `tests/workflow-tool.test.ts` — closest test patterns.

Key current excerpts:

```ts
// .pi/extensions/pi-workflow-engine/src/agent-runner.ts:17-25
export interface AgentRunnerSession {
  readonly state: { readonly messages: readonly unknown[] };
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: AgentRunnerEvent) => void): () => void;
  dispose(): void;
  abort(): Promise<void>;
}
```

```ts
// .pi/extensions/pi-workflow-engine/src/agent-runner.ts:37-45
export interface RunContext {
  cwd: string;
  hostModel: Model<Api> | undefined;
  modelRegistry: Pick<ModelRegistry, "find">;
  semaphore: Semaphore;
  progress: AgentProgress;
  signal: AbortSignal | undefined;
  perf: PerfSink;
  createSession?: CreateAgentSession;
}
```

```ts
// .pi/extensions/pi-workflow-engine/src/agent-runner.ts:167
sessionManager: SessionManager.inMemory(rc.cwd),
```

```ts
// .pi/extensions/pi-workflow-engine/index.ts:24-41
function formatMessageContent(name: string, result: unknown, perf?: WorkflowPerfDetails): string {
  const perfLine = formatPerfLine(perf);
  return `## Workflow: ${name}\n\n${summarize(result)}${perfLine ? `\n\n${perfLine}` : ""}`;
}

function workflowEnvelope(name: string, result: unknown, perf?: WorkflowPerfDetails): WorkflowResultEnvelope {
  return { name, result, completedAt: Date.now(), perf };
}
```

```ts
// .pi/extensions/pi-workflow-engine/src/ui/workflow-result-renderer.ts:9-19
export interface WorkflowPerfDetails {
  readonly enabled: boolean;
  readonly startedAt: number;
  readonly aggregates: readonly PerfAggregate[];
}

export interface WorkflowResultEnvelope {
  name: string;
  result: unknown;
  completedAt: number;
  perf?: WorkflowPerfDetails;
}
```

Repo conventions to preserve:

- Core pi packages and `typebox` are peer dependencies; do not add runtime dependencies.
- Do not use `as any`; use structural narrowing and typed helper functions.
- Built-in workflows and inline workflows must keep using pi's bundled TypeBox identity; this plan must not alter workflow compilation/discovery.
- `perf` means internal timing. Usage/cost reporting must be separate and should not require `--perf`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Tests | `bun run test` | exit 0, all tests pass |
| Focused tests while iterating | `bun test tests/usage.test.ts tests/agent-runner-perf.test.ts tests/workflow-ui.test.ts tests/workflow-perf.test.ts tests/workflow-tool.test.ts tests/sub-workflow.test.ts` | exit 0 |

If dependencies are missing locally, run `bun install` as documented in `AGENTS.md`; do not commit dependency or lockfile changes unless the operator explicitly requests it.

## Scope

**In scope** — files you may modify or create:

- `.pi/extensions/pi-workflow-engine/src/usage.ts` (new)
- `.pi/extensions/pi-workflow-engine/src/agent-runner.ts`
- `.pi/extensions/pi-workflow-engine/src/engine.ts`
- `.pi/extensions/pi-workflow-engine/src/types.ts`
- `.pi/extensions/pi-workflow-engine/index.ts`
- `.pi/extensions/pi-workflow-engine/src/ui/workflow-result-renderer.ts`
- Tests under `tests/` for usage aggregation, runner integration, workflow result rendering, and existing helper updates
- `README.md`
- `USAGE.md`
- `plans/README.md` status row after completion

**Out of scope** — do not touch unless a maintainer explicitly expands scope:

- Pi core packages under `/home/timbo/.bun/install/...` or `node_modules/`
- Package metadata, release process, or dependency declarations
- Workflow behavior, prompts, schemas, or review-finding logic
- Mutating host assistant `usage` to force pi footer/session stats to include workflow costs

## Git workflow

- Branch suggestion: `feat/workflow-usage-cost-reporting`.
- Commit style in recent history is mixed; prefer conventional commit style where possible, e.g. `feat: report workflow usage costs`.
- Do not push or open a PR unless the operator instructs it.

## Design requirements

1. **Aggregate actual usage only**: Sum assistant-message `usage` objects emitted by each subagent session after it runs. Do not estimate future costs.
2. **Collect before disposal**: Capture from `activeSession.state.messages` in `runAgent()` before `dispose()` is called, including failure paths when a session exists.
3. **Keep usage separate from perf**: Usage reporting is always available; `--perf` / `PI_WORKFLOW_PERF=1` still controls timing aggregates only.
4. **Do not break context accounting**: Do not add subagent token counts to host assistant `usage.input/output/cache*`; pi uses assistant usage for context-window estimates.
5. **Expose machine-readable details**: Include usage in `WorkflowResultEnvelope.details` so RPC/TUI/tool consumers can inspect it.
6. **Expose human-readable summary**: Add a concise cost/token line to command results, tool results, and rendered workflow messages.
7. **Handle zero-price models**: If model pricing is missing or zero, show token totals and `$0.000` cost rather than failing.
8. **No `as any`**: Structural guards must use `unknown`, `Record<string, unknown>`, and explicit numeric checks.

## Steps

### Step 1: Add a workflow usage aggregation module

Create `.pi/extensions/pi-workflow-engine/src/usage.ts`.

Implement exported types similar to:

```ts
export interface WorkflowUsageCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

export interface WorkflowUsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost: WorkflowUsageCost;
}

export interface WorkflowAgentUsage {
  readonly label: string;
  readonly phase?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly assistantMessages: number;
  readonly usage: WorkflowUsageTotals;
}

export interface WorkflowUsageSnapshot {
  readonly agents: readonly WorkflowAgentUsage[];
  readonly totals: WorkflowUsageTotals;
  readonly assistantMessages: number;
}

export interface WorkflowUsageSink {
  recordAgentSession(input: { label: string; phase?: string; messages: readonly unknown[] }): void;
  snapshot(): WorkflowUsageSnapshot;
}
```

Implementation notes:

- Provide `WorkflowUsageRecorder` and `NoopWorkflowUsageRecorder` only if a no-op simplifies tests; otherwise one recorder that can represent empty totals is enough.
- Add `createWorkflowUsageRecorder()` for symmetry with `createPerfRecorder()`.
- Add `formatWorkflowUsageLine(snapshot)` helper if useful for shared command/tool text.
- `recordAgentSession()` should scan `messages` for objects with `role === "assistant"` and a valid `usage` shape.
- Sum all assistant messages in a subagent session; a tool-using subagent can produce multiple assistant messages.
- Preserve the most recent `provider`/`model` found in that agent session for per-agent reporting.
- If an agent session has no valid assistant usage, either skip it or record an entry with zero totals only if that is useful for debugging. Prefer skipping zero/no-usage agents so the summary stays meaningful.

**Verify**: add `tests/usage.test.ts` covering:

- sums input/output/cacheRead/cacheWrite/totalTokens and cost components across multiple assistant messages;
- ignores user/tool/custom/malformed messages;
- preserves per-agent label/phase/provider/model;
- empty input returns zero totals and no agents.

Run `bun test tests/usage.test.ts` → all tests pass.

### Step 2: Record subagent usage in `runAgent()`

Modify `.pi/extensions/pi-workflow-engine/src/agent-runner.ts`:

- Import `type WorkflowUsageSink` from `./usage.ts`.
- Add `usage: WorkflowUsageSink` to `RunContext`.
- In `runAgent()`, record usage exactly once for each created session before `dispose()`.
- Use the scoped `label` and resolved `phase` already computed at the top of `runAgent()`.
- Record in a `finally` block so failures/aborts still capture completed assistant usage when available.

Suggested shape:

```ts
let usageRecorded = false;
function recordUsage(activeSession: AgentRunnerSession): void {
  if (usageRecorded) return;
  usageRecorded = true;
  rc.usage.recordAgentSession({ label, phase, messages: activeSession.state.messages });
}
```

Call `recordUsage(activeSession)` after `prompt()` completes and again defensively in `finally` if `session` exists. Keep `dispose()` after usage recording.

Update every test helper constructing a `RunContext` to supply a usage recorder.

**Verify**:

- Add/update tests in `tests/agent-runner-perf.test.ts` or a new `tests/agent-runner-usage.test.ts` with a fake session containing assistant messages with usage.
- Assert `runAgent()` records those totals while still returning the expected text/structured result.
- Add a failure-path test where `prompt()` throws after the fake session has a usage-bearing assistant message; assert usage is still recorded and the original error still propagates.

Run `bun test tests/agent-runner-perf.test.ts tests/agent-runner-usage.test.ts` (omit the new file if you add the tests to the existing file) → all tests pass.

### Step 3: Thread one recorder through the whole workflow tree

Modify `.pi/extensions/pi-workflow-engine/src/engine.ts` and `.pi/extensions/pi-workflow-engine/src/types.ts`:

- Create one usage recorder in `runWorkflow()` near the existing perf recorder.
- Add it to `RunContext` so all top-level agents use it.
- Ensure `api.workflow()` sub-workflows share the same recorder because they reuse `{ ...rc, signal: childController.signal }`.
- Extend `WorkflowRunOptions` with:

```ts
onUsageSnapshot?: (snapshot: WorkflowUsageSnapshot) => void;
```

- In `runWorkflow()` `finally`, call `resolvedOptions.onUsageSnapshot?.(usage.snapshot())` before or near the existing perf/progress callbacks.
- Do not gate usage on `resolvedOptions.perf`.

**Verify**:

- Update `tests/sub-workflow.test.ts` helper `createRc()` to include a recorder.
- Add an integration test using `runWorkflowWithContext()` with a parent workflow that calls both `api.agent()` and `api.workflow("child")`; fake `createSession` should return usage-bearing assistant messages. Assert the shared recorder contains both parent and child agent usage.
- Run `bun test tests/sub-workflow.test.ts` → all tests pass.

### Step 4: Surface usage in workflow result envelopes and text

Modify `.pi/extensions/pi-workflow-engine/index.ts` and `.pi/extensions/pi-workflow-engine/src/ui/workflow-result-renderer.ts`:

- Extend `WorkflowResultEnvelope` with `usage?: WorkflowUsageDetails` or the compact snapshot type.
- Keep full samples out of user-facing details if they become large; a compact snapshot with totals + per-agent summaries is enough.
- Update `workflowEnvelope()` to accept usage and include it in `details`.
- Update `formatMessageContent()` to include a usage line after the summary and before/near `Perf:`.
- Update the `workflow` tool `execute()` path to return text containing the same usage line and details containing the usage snapshot.
- Update `sendWorkflowResult()` command path similarly.
- Update `renderWorkflowResultText()` so collapsed workflow messages show a concise usage line. Expanded generic/advisory result rendering may additionally show a per-agent usage summary if it fits cleanly.

Recommended display format:

```text
Usage: ↑12.3k ↓1.8k R40.0k W5.0k · cost $0.123 · agents 8
```

Use existing `formatCount()` for token-like counts where possible. Only show cache read/write parts when non-zero. Always show cost when tokens or cost are non-zero.

**Verify**:

- Add/update `tests/workflow-ui.test.ts` to assert collapsed and expanded workflow rendering includes `Usage:` and a formatted cost.
- Add/update `tests/workflow-perf.test.ts` to assert `runWorkflow()` invokes `onUsageSnapshot` even when `perf` is false.
- Add/update `tests/workflow-tool.test.ts` if practical to assert `WorkflowResultEnvelope` with usage renders via the registered tool/message renderer. Avoid tests that require live LLM calls.
- Run `bun test tests/workflow-ui.test.ts tests/workflow-perf.test.ts tests/workflow-tool.test.ts` → all tests pass.

### Step 5: Document the semantics and limitation clearly

Update `README.md` and `USAGE.md`:

- In the Dynamax/workflow results sections, state that workflow results now include workflow-level token and cost totals gathered from subagent sessions.
- Clarify that this is separate from `--perf`, which remains timing-only.
- Clarify that pi's built-in footer/session stats may still show host-session usage only unless pi core gains a first-class extension usage API. Do **not** promise that `/session` or the footer include workflow usage.
- Mention zero-price model behavior: token totals can be non-zero while cost remains `$0.000` when model pricing is unavailable.

**Verify**: `rg -n "usage|cost|perf|footer|session" README.md USAGE.md` → docs contain the new semantics and do not overpromise built-in footer support.

### Step 6: Full verification and cleanup

Run the full gates:

1. `bun run typecheck` → exit 0.
2. `bun run test` → exit 0.
3. `git diff --stat` → only in-scope files changed.
4. Review `git diff` manually for:
   - no `as any`;
   - no runtime dependency additions;
   - no changes to workflow prompts/schemas;
   - no mutation of host assistant message `usage`;
   - usage collection occurs before subagent session disposal.

Update `plans/README.md` status for this plan to `DONE` only after all gates pass.

## Test plan

New or updated tests must cover:

- `usage.ts` structural extraction and summing logic.
- `runAgent()` records usage before disposal and on failure paths.
- One recorder is shared across parent and sub-workflows.
- Workflow result envelopes include usage snapshots.
- TUI/text rendering shows a concise usage line.
- Existing perf behavior remains unchanged and timing only.

Use existing test style: Bun's `test()` from `bun:test`, `node:assert/strict`, fake sessions instead of LLM calls.

## Done criteria

All must hold:

- [ ] `bun run typecheck` exits 0.
- [ ] `bun run test` exits 0.
- [ ] A new usage aggregation module exists and has focused unit tests.
- [ ] `RunContext` carries a workflow usage recorder.
- [ ] `runAgent()` records subagent assistant usage before session disposal.
- [ ] Parent and sub-workflow agents share the same usage snapshot.
- [ ] `/workflow` command results include a human-readable usage/cost line.
- [ ] `workflow` tool results include a human-readable usage/cost line and machine-readable details.
- [ ] Workflow result renderer displays usage in collapsed output.
- [ ] README/USAGE document that workflow usage is separate from pi core footer/session totals.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:

- Pi's `AgentSession` state no longer exposes assistant messages with `usage` in `state.messages`.
- Capturing usage requires parsing provider event streams or provider-specific payloads instead of using finalized assistant messages.
- Making `/session` or the footer include workflow cost becomes a hard requirement; that needs a pi core extension-usage API or a carefully designed upstream change, because host assistant token usage also drives context-window estimates.
- The implementation appears to require `as any`, a new runtime dependency, or changes to workflow prompt behavior.
- A verification command fails twice after reasonable fixes.

## Maintenance notes

- Future workflow surfaces should pass through `WorkflowResultEnvelope.usage` rather than inventing another cost format.
- If pi core later adds first-class extension usage accounting, migrate the recorder output to that API and remove any docs saying footer/session stats are host-only.
- Reviewers should scrutinize failure/abort behavior: usage should be recorded when a subagent has completed assistant messages, but original workflow errors must still propagate.
- Keep usage and perf separate in naming, UI, and docs; conflating them will confuse users and tests.

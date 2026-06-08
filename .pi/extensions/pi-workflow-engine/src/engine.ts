import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parallel, pipeline, Semaphore } from "./concurrency.ts";
import { linkAbortSignal } from "./cancellation.ts";
import { runAgent, type RunContext } from "./agent-runner.ts";
import { ProgressTracker } from "./progress.ts";
import { createPerfRecorder, type PerfSnapshot } from "./perf.ts";
import { defaultConcurrency, resolveWorkflowRunOptions } from "./options.ts";
import type { AgentOptions, WorkflowApi, WorkflowModule, WorkflowRunOptions } from "./types.ts";
import { WorkflowInspector } from "./ui/workflow-inspector.ts";

/** Default global cap on concurrent agents per run. */
const DEFAULT_CONCURRENCY = defaultConcurrency();

/**
 * Run a workflow module: build the per-run primitives (binding agent/parallel/pipeline
 * to a shared semaphore + progress tracker), invoke the workflow, return its result.
 */
export async function runWorkflow(
  ctx: ExtensionContext,
  mod: WorkflowModule,
  args: string,
  options: WorkflowRunOptions = {},
): Promise<unknown> {
  const resolvedOptions = resolveWorkflowRunOptions(options);
  const progress = new ProgressTracker(ctx, mod.meta.name);
  if (resolvedOptions.inspect && ctx.hasUI) {
    void ctx.ui
      .custom<void>(
        (tui, theme, _keybindings, done) => new WorkflowInspector(() => progress.snapshot(), tui, theme, () => done(undefined)),
        { overlay: true, overlayOptions: { anchor: "right-center", width: "60%", maxHeight: "80%", margin: 1 } },
      )
      .catch((error: unknown) => progress.log(`inspector failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  const perf = resolvedOptions.perfRecorder ?? createPerfRecorder(resolvedOptions.perf);
  const runAbortController = new AbortController();
  const unlinkContextAbortSignal = linkAbortSignal(ctx.signal, runAbortController);
  const unlinkOptionAbortSignal = linkAbortSignal(resolvedOptions.signal, runAbortController);
  const rc: RunContext = {
    cwd: ctx.cwd,
    hostModel: ctx.model,
    modelRegistry: ctx.modelRegistry,
    semaphore: new Semaphore(resolvedOptions.concurrency ?? DEFAULT_CONCURRENCY),
    progress,
    signal: runAbortController.signal,
    perf,
  };

  const agent = ((prompt: string, opts?: AgentOptions) => runAgent(rc, prompt, opts)) as WorkflowApi["agent"];

  const api: WorkflowApi = {
    agent,
    parallel: (thunks) =>
      parallel(thunks, {
        signal: runAbortController.signal,
        abortController: runAbortController,
        limit: resolvedOptions.parallelSubmissionLimit ?? resolvedOptions.concurrency * 2,
      }),
    pipeline,
    phase: (title) => progress.phase(title),
    log: (message) => progress.log(message),
    progress: (event) => progress.event(event),
    args,
    cwd: ctx.cwd,
    signal: runAbortController.signal,
  };

  try {
    return await perf.time("workflow.total_ms", () => mod.default(api));
  } finally {
    try {
      const snapshot = perf.snapshot();
      if (resolvedOptions.perf) {
        resolvedOptions.onPerfSnapshot?.(snapshot);
        progress.log(formatPerfSummary(snapshot));
      }
      progress.done();
      resolvedOptions.onProgressSnapshot?.(progress.snapshot());
    } finally {
      unlinkContextAbortSignal();
      unlinkOptionAbortSignal();
    }
  }
}

function formatPerfSummary(snapshot: PerfSnapshot): string {
  const parts = snapshot.aggregates
    .filter((aggregate) => aggregate.count > 0)
    .slice(0, 5)
    .map((aggregate) => `${aggregate.name} ${Math.round(aggregate.total)}ms`);
  return parts.length > 0 ? `perf: ${parts.join(", ")}` : "perf: no samples";
}

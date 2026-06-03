import { Type } from "typebox";
import type { AdvisoryReport } from "../src/advisory-schema.ts";
import type { WorkflowApi, WorkflowMeta, WorkflowRunStats } from "../src/types.ts";

export const meta: WorkflowMeta = {
  name: "perf-review",
  description: "Advisory-only performance review: scope slow path → per-lens bottleneck hypotheses → verify evidence → synthesize measurements and safe optimizations.",
  phases: [{ title: "Scope" }, { title: "Find" }, { title: "Verify" }, { title: "Synthesize" }],
};

const ScopeSchema = Type.Object({
  target: Type.String({ description: "Verbatim slow path, workload, command, or performance concern." }),
  files: Type.Array(Type.String(), { description: "Repository-relative files likely involved in the performance path." }),
  commands: Type.Array(Type.String(), { description: "Existing benchmark, smoke, or measurement commands relevant to this path." }),
  summary: Type.String({ description: "One-paragraph summary of the performance-relevant path." }),
  knownMeasurements: Type.Optional(Type.String({ description: "Existing measurements, timings, or explicit lack of measurements." })),
});

interface PerfLens {
  label: string;
  category: string;
  text: string;
}

const PERF_LENSES: PerfLens[] = [
  { label: "algorithmic", category: "algorithmic", text: "Complexity, repeated scans, avoidable nested loops, or data-structure choices that grow poorly with input size." },
  { label: "io", category: "io", text: "Filesystem, subprocess, network, or other I/O costs on hot paths or startup paths." },
  { label: "concurrency", category: "concurrency", text: "Unnecessary serialization, missing batching, excessive fan-out, contention, or concurrency limits." },
  { label: "startup", category: "startup", text: "Import/module loading, initialization, discovery, or cold-start overhead." },
  { label: "allocation", category: "allocation", text: "Memory churn, large intermediate strings/objects, repeated serialization, or retained state growth." },
  { label: "measurement", category: "measurement", text: "Missing, misleading, noisy, or insufficient benchmark/measurement design." },
];

const TOOLS = ["read", "bash"];
const PER_LENS = 4;

export default async function run(api: WorkflowApi): Promise<unknown> {
  const { agent, phase, log, progress, args } = api;
  const target = args.trim() || "repository performance";
  let fileCount = 0;
  const makeStats = (candidates: number, verified: number, kept: number): WorkflowRunStats => ({
    files: fileCount,
    candidates,
    verified,
    kept,
  });

  phase("Scope");
  const scope = await agent(
    "Establish the scope for an advisory-only performance review. Do not edit files.\n" +
      `Performance target / concern (verbatim): ${target}\n\n` +
      "Inspect repository structure, scripts, likely hot-path files, and any existing benchmark or measurement commands. " +
      "Prefer identifying what to measure before claiming bottlenecks. Return files, commands, summary, and known measurements or the lack of them. " +
      `This workflow will later fan out across ${PERF_LENSES.length} lenses with up to ${PER_LENS} candidates per lens. Structured output only.`,
    { phase: "Scope", label: "scope", tools: TOOLS, thinkingLevel: "medium", schema: ScopeSchema },
  );

  if (!scope || scope.files.length === 0) {
    return emptyReport(
      "No performance-relevant files were identified.",
      ["Provide a slow command, workload, file path, or user-visible latency concern to review."],
      makeStats(0, 0, 0),
    );
  }

  fileCount = scope.files.length;
  progress({ type: "counter", key: "files", label: "files", value: fileCount });
  progress({ type: "summary", key: "target", value: scope.target });
  progress({ type: "summary", key: "files", value: scope.files.join(", ") });
  log(`${scope.files.length} files scoped for performance review`);

  return emptyReport(
    `Performance review scoped ${scope.files.length} file(s); find/verify/synthesize stages are not implemented yet.`,
    ["Complete the planned find, verify, and synthesize stages before using this workflow."],
    makeStats(0, 0, 0),
  );
}

function emptyReport(summary: string, nextSteps: string[], stats: WorkflowRunStats): AdvisoryReport & { stats: WorkflowRunStats } {
  return { summary, findings: [], nextSteps, stats };
}

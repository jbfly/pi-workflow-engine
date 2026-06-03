import { Type } from "typebox";
import { AdvisoryCandidatesSchema, type AdvisoryCandidate, type AdvisoryReport } from "../src/advisory-schema.ts";
import type { WorkflowApi, WorkflowMeta, WorkflowRunStats } from "../src/types.ts";

export const meta: WorkflowMeta = {
  name: "diagnose",
  description: "Advisory-only bug diagnosis: scope symptoms → competing hypotheses → independent verify → synthesize likely root causes.",
  phases: [{ title: "Scope" }, { title: "Hypothesize" }, { title: "Verify" }, { title: "Synthesize" }],
};

const ScopeSchema = Type.Object({
  symptom: Type.String({ description: "Observed bug, failing command, regression, or unclear behavior." }),
  commands: Type.Array(Type.String(), { description: "Safe read-only or diagnostic commands relevant to the symptom." }),
  files: Type.Array(Type.String(), { description: "Repository-relative files likely involved." }),
  observations: Type.Array(Type.String(), { description: "Concrete observations from files, tests, config, or command output." }),
  constraints: Type.Optional(Type.String({ description: "Safety constraints, missing evidence, or commands intentionally not run." })),
});

interface HypothesisLens {
  label: string;
  category: string;
  text: string;
}

const HYPOTHESIS_LENSES: HypothesisLens[] = [
  { label: "recent-change", category: "regression", text: "A recent code change broke a previously working path or changed an implicit contract." },
  { label: "control-flow", category: "root-cause", text: "Incorrect branching, ordering, async flow, data flow, or state transition causes the symptom." },
  { label: "configuration", category: "configuration", text: "Configuration, environment, package scripts, or runtime assumptions differ from what the code expects." },
  { label: "dependency-api", category: "dependency", text: "A dependency API, version, import mode, or bundled peer behavior does not match the implementation." },
  { label: "test-fixture", category: "test-fixture", text: "The failure is caused by test setup, fixtures, mocks, generated files, or stale local state rather than product code." },
];

const TOOLS = ["read", "bash"];
const PER_LENS = 4;

type Candidate = AdvisoryCandidate;

export default async function run(api: WorkflowApi): Promise<unknown> {
  const { agent, parallel, phase, log, progress, args } = api;
  const symptom = args.trim();
  let fileCount = 0;
  let candidateCount = 0;
  const makeStats = (verified: number, kept: number): WorkflowRunStats => ({
    files: fileCount,
    candidates: candidateCount,
    verified,
    kept,
  });

  phase("Scope");
  const scope = await agent(
    "Establish the scope for an advisory-only diagnosis workflow. Do not edit files.\n" +
      (symptom
        ? `Bug / failure description (verbatim): ${symptom}\n\n`
        : "No explicit symptom was provided. Infer likely failing commands from repository manifests and scripts without running destructive commands.\n\n") +
      "Inspect relevant files, package/test configuration, and safe diagnostic commands. " +
      "Safe commands are read-only commands such as status, grep, listing files, typecheck/test commands, or commands explicitly requested by the user. " +
      "Do not run mutation, install, commit, network, or destructive commands. Return scoped files, observations, and constraints. Structured output only.",
    { phase: "Scope", label: "scope", tools: TOOLS, thinkingLevel: "medium", schema: ScopeSchema },
  );

  if (!scope) {
    return emptyReport(
      "Diagnosis could not establish a scope.",
      ["Provide the failing command, error message, or regression description and rerun diagnose."],
      makeStats(0, 0),
    );
  }

  fileCount = scope.files.length;
  progress({ type: "counter", key: "files", label: "files", value: fileCount });
  progress({ type: "summary", key: "symptom", value: scope.symptom });
  progress({ type: "summary", key: "files", value: scope.files.join(", ") || "(none)" });
  log(`${scope.files.length} files scoped for diagnosis`);

  const scopeBlock =
    `## Symptom\n${scope.symptom}\n\n## Relevant commands\n${scope.commands.map((command) => `- ${command}`).join("\n") || "(none)"}\n\n` +
    `## Files\n${scope.files.map((file) => `- ${file}`).join("\n") || "(none)"}\n\n` +
    `## Observations\n${scope.observations.map((observation) => `- ${observation}`).join("\n") || "(none)"}\n\n` +
    `## Constraints\n${scope.constraints ?? "(none noted)"}\n`;

  phase("Hypothesize");
  const perLens = await parallel(
    HYPOTHESIS_LENSES.map((lens) => async (): Promise<Candidate[]> => {
      const found = await agent(
        `## Diagnose hypothesis generator — ${lens.label}\n\n${scopeBlock}\n` +
          "This workflow is advisory-only: diagnose and recommend validation/fix plans, but do not edit files.\n" +
          `Consider ONLY this hypothesis lens:\n${lens.text}\n\n` +
          `Surface up to ${PER_LENS} root-cause hypotheses. Use category exactly "${lens.category}". ` +
          "Each hypothesis must include a one-line summary, locations, impact explaining how it produces the symptom, and an optional recommendation for the next validation step. Structured output only.",
        { phase: "Hypothesize", label: `hypothesize:${lens.label}`, tools: TOOLS, thinkingLevel: "low", schema: AdvisoryCandidatesSchema },
      );
      const candidates = (found?.candidates ?? []).slice(0, PER_LENS);
      candidateCount += candidates.length;
      progress({ type: "counter_delta", key: "candidates", label: "candidates", delta: candidates.length });
      for (const candidate of candidates) {
        progress({
          type: "lane_item",
          lane: "Hypotheses",
          title: candidate.summary,
          subtitle: formatLocation(candidate),
          status: "pending",
          details: candidate.impact,
        });
      }
      return candidates;
    }),
  );

  const hypotheses = perLens.flat();
  return emptyReport(
    `Diagnosis generated ${hypotheses.length} hypothesis/hypotheses; verification and synthesis are not implemented yet.`,
    ["Complete the planned verification and synthesis stages before using this workflow for final diagnosis."],
    makeStats(0, 0),
  );
}

function emptyReport(summary: string, nextSteps: string[], stats: WorkflowRunStats): AdvisoryReport & { stats: WorkflowRunStats } {
  return { summary, findings: [], nextSteps, stats };
}

function formatLocation(candidate: Pick<Candidate, "locations">): string {
  const location = candidate.locations[0];
  if (!location) return "(no location)";
  const line = location.line != null ? `:${location.line}` : "";
  const symbol = location.symbol ? ` (${location.symbol})` : "";
  return `${location.file}${line}${symbol}`;
}

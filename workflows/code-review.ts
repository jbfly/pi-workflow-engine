import { Type } from "typebox";
import type { WorkflowApi, WorkflowMeta } from "../src/types.ts";

export const meta: WorkflowMeta = {
  name: "code-review",
  description: "Fan-out review of the branch's open PR (or branch vs main): scope → per-angle find → independent verify → synthesize.",
  phases: [{ title: "Scope" }, { title: "Find" }, { title: "Verify" }, { title: "Synthesize" }],
};

// ─── Schemas (the contracts that make orchestration plain code) ───
const ScopeSchema = Type.Object({
  diffCommand: Type.String({ description: "Exact git command that produces the review diff" }),
  files: Type.Array(Type.String(), { description: "Changed file paths" }),
  summary: Type.String({ description: "One-paragraph summary of the change" }),
  conventions: Type.Optional(Type.String({ description: "Relevant CLAUDE.md / project conventions" })),
});

const CandidatesSchema = Type.Object({
  candidates: Type.Array(
    Type.Object({
      file: Type.String(),
      line: Type.Optional(Type.Number()),
      summary: Type.String({ description: "One-line description of the issue" }),
      failure_scenario: Type.String({ description: "Concrete scenario where this causes a problem" }),
    }),
  ),
});

const VerdictSchema = Type.Object({
  verdict: Type.Union([Type.Literal("CONFIRMED"), Type.Literal("PLAUSIBLE"), Type.Literal("REFUTED")]),
  evidence: Type.String({ description: "Quote or cite the relevant line(s)" }),
});

const ReportSchema = Type.Object({
  summary: Type.String(),
  findings: Type.Array(
    Type.Object({
      file: Type.String(),
      line: Type.Optional(Type.Number()),
      severity: Type.Union([Type.Literal("bug"), Type.Literal("cleanup")]),
      verdict: Type.Union([Type.Literal("CONFIRMED"), Type.Literal("PLAUSIBLE")]),
      summary: Type.String(),
    }),
  ),
});

interface Candidate {
  file: string;
  line?: number;
  summary: string;
  failure_scenario: string;
}
interface Angle {
  label: string;
  kind: "bug" | "cleanup";
  text: string;
}
interface Verified extends Candidate {
  verdict: "CONFIRMED" | "PLAUSIBLE" | "REFUTED";
  evidence: string;
  kind: "bug" | "cleanup";
}

// The review lenses — this is the part you customise to your codebase's real failure modes.
const ANGLES: Angle[] = [
  { label: "logic-bugs", kind: "bug", text: "Off-by-one errors, wrong conditionals, incorrect return values, broken control flow." },
  { label: "error-paths", kind: "bug", text: "Unhandled errors, swallowed exceptions, missing awaits, partial failure leaving inconsistent state." },
  { label: "edge-cases", kind: "bug", text: "Empty/null inputs, boundary values, concurrency races, resource leaks." },
  { label: "simplification", kind: "cleanup", text: "Dead code, needless complexity, duplicated logic, clearer equivalents." },
  { label: "conventions", kind: "cleanup", text: "Violations of the project conventions noted in scope (naming, idioms, banned patterns)." },
];

const TOOLS = ["read", "bash"];
const PER_ANGLE = 6;

export default async function run(api: WorkflowApi): Promise<unknown> {
  const { agent, parallel, pipeline, phase, log, args } = api;
  const target = args.trim();

  // ─── Phase 0: Scope ───
  phase("Scope");
  const scope = await agent(
    "Establish the scope of a code review.\n" +
      (target
        ? `Target / instructions (verbatim): "${target}". If it names a PR number, branch, ref range, or files, build the matching diff command (use 'gh pr diff <number>' for a PR). Otherwise use the default selection below.\n`
        : "No explicit target — select the diff to review using the default below.\n") +
      "Default selection — run commands to decide, falling through until you get a NON-EMPTY diff:\n" +
      "1. Get the current branch: `git branch --show-current`.\n" +
      "2. Check for an OPEN GitHub PR for this branch: `gh pr list --head <branch> --state open --json number,title`. " +
      "If one exists, the diff command is `gh pr diff <number>` — note the PR number and title in the summary.\n" +
      "3. If there is no open PR (or `gh` is unavailable / there is no GitHub remote), diff the branch against its base: " +
      "prefer `git diff main...HEAD`, then `git diff master...HEAD`, then `git diff HEAD~1`. " +
      "If the branch itself is main/master, use `git diff HEAD~1`.\n" +
      "4. Run the chosen command to confirm the diff is non-empty.\n\n" +
      "Then: list the changed files, summarize the change in one paragraph (mention the PR if one was found), " +
      "and read any relevant CLAUDE.md noting conventions a reviewer should know.\n" +
      "Return diffCommand exactly as a reviewer should run it. Structured output only.",
    { phase: "Scope", label: "scope", tools: TOOLS, thinkingLevel: "medium", schema: ScopeSchema },
  );

  if (!scope || scope.files.length === 0) {
    return { summary: "No changes found to review.", findings: [], stats: { candidates: 0, verified: 0 } };
  }
  log(`${scope.files.length} changed files`);

  const scopeBlock =
    `## Diff command\n${scope.diffCommand}\n\n## Changed files\n${scope.files.map((file) => `- ${file}`).join("\n")}\n\n` +
    `## Summary\n${scope.summary}\n\n## Conventions\n${scope.conventions ?? "(none noted)"}\n` +
    (target ? `\n## User instructions (verbatim)\n${target}\n` : "");

  // Dedup state accumulates as finders complete (the pipeline has no barrier).
  const seen = new Set<string>();
  const dedupKey = (candidate: Candidate): string =>
    `${candidate.file}:${candidate.line != null ? Math.round(candidate.line / 5) * 5 : candidate.summary.slice(0, 40).toLowerCase()}`;

  // ─── Find → dedup → Verify (no barrier between stages) ───
  phase("Find");
  const perAngle = await pipeline(
    ANGLES,
    // Stage 1: each angle finds candidates through its single lens.
    async (_prev, item) => {
      const angle = item as Angle;
      const found = await agent(
        `## Code-review finder — ${angle.label}\n\n${scopeBlock}\n` +
          `Run the diff command and review ONLY through this lens:\n${angle.text}\n` +
          `Surface up to ${PER_ANGLE} candidates, each with file, line, a one-line summary, and a concrete failure_scenario. ` +
          "Pass through anything with a nameable failure scenario — a separate verifier judges them next. Structured output only.",
        { phase: "Find", label: `find:${angle.label}`, tools: TOOLS, thinkingLevel: "low", schema: CandidatesSchema },
      );
      return { angle, candidates: (found?.candidates ?? []).slice(0, PER_ANGLE) };
    },
    // Stage 2: dedup against the shared set, then verify survivors concurrently.
    async (prev) => {
      const { angle, candidates } = prev as { angle: Angle; candidates: Candidate[] };
      const novel = candidates.filter((candidate) => {
        const key = dedupKey(candidate);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const verdicts = await parallel(
        novel.map((candidate) => async (): Promise<Verified | null> => {
          const judged = await agent(
            `## Code-review verifier\n\n${scopeBlock}\n## Candidate\n` +
              `File: ${candidate.file}${candidate.line != null ? `:${candidate.line}` : ""}\n` +
              `Summary: ${candidate.summary}\nFailure scenario: ${candidate.failure_scenario}\n\n` +
              "Run the diff command, read the relevant file(s), and return exactly one verdict (CONFIRMED / PLAUSIBLE / REFUTED) " +
              "with evidence quoting the line(s). Default toward REFUTED if you cannot substantiate it. Structured output only.",
            { phase: "Verify", label: `verify:${candidate.file.split("/").pop() ?? candidate.file}`, tools: TOOLS, thinkingLevel: "low", schema: VerdictSchema },
          );
          return judged ? { ...candidate, verdict: judged.verdict, evidence: judged.evidence, kind: angle.kind } : null;
        }),
      );
      return verdicts.filter((value): value is Verified => value !== null);
    },
  );

  const verified = (perAngle as Verified[][]).flat();
  const surviving = verified.filter((finding) => finding.verdict !== "REFUTED");
  log(`${verified.length} verified → ${surviving.length} kept`);

  if (surviving.length === 0) {
    return { summary: "No findings survived verification.", findings: [], stats: { candidates: seen.size, verified: verified.length } };
  }

  // ─── Synthesize: rank, merge, report ───
  phase("Synthesize");
  const rank = (finding: Verified): number => (finding.kind === "cleanup" ? 2 : 0) + (finding.verdict === "PLAUSIBLE" ? 1 : 0);
  const ranked = [...surviving].sort((a, b) => rank(a) - rank(b));
  const block = ranked
    .map(
      (finding, index) =>
        `### [${index}] ${finding.file}${finding.line != null ? `:${finding.line}` : ""} (${finding.verdict}${finding.kind === "cleanup" ? ", cleanup" : ""})\n` +
        `${finding.summary}\nFailure: ${finding.failure_scenario}\nEvidence: ${finding.evidence}`,
    )
    .join("\n\n");

  const report = await agent(
    `## Synthesis: final code-review report\n\n${ranked.length} findings survived independent verification.\n\n${block}\n\n` +
      "Merge findings with the same root cause, rank most-severe first (correctness bugs above cleanups), and produce the final report. Structured output only.",
    { phase: "Synthesize", label: "synthesize", thinkingLevel: "medium", schema: ReportSchema },
  );

  return report ?? { summary: "Synthesis produced no output.", findings: [] };
}

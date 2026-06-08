import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowRunOptions } from "../types.ts";
import { isAdvisoryReport, type AdvisoryWorkflowResult } from "../ui/workflow-result-renderer.ts";
import { toReviewIssues, type ReviewIssue, type ReviewIssueSelection } from "./review-issues.ts";
import { ReviewResultsViewer } from "./review-results-viewer.ts";

export type ReviewResultsPresentationDecision =
  | {
      readonly kind: "send";
      readonly reason: "tool-invocation" | "not-code-review" | "not-advisory" | "no-findings" | "disabled" | "not-tui" | "not-requested";
    }
  | { readonly kind: "open"; readonly report: AdvisoryWorkflowResult; readonly issues: readonly ReviewIssue[]; readonly findingCount: number };

export interface ReviewResultsDecisionInput {
  readonly workflowName: string;
  readonly result: unknown;
  readonly mode?: string;
  readonly hasUI: boolean;
  readonly resultViewer?: WorkflowRunOptions["resultViewer"];
  readonly invocationKind?: "command" | "tool";
}

export interface ReviewResultsViewerContext {
  readonly ui: Pick<ExtensionCommandContext["ui"], "custom">;
}

export function extensionContextMode(ctx: ExtensionCommandContext): string | undefined {
  const candidate = (ctx as ExtensionCommandContext & { readonly mode?: unknown }).mode;
  return typeof candidate === "string" ? candidate : undefined;
}

export function decideReviewResultsPresentation(input: ReviewResultsDecisionInput): ReviewResultsPresentationDecision {
  if (input.invocationKind === "tool") return { kind: "send", reason: "tool-invocation" };
  if (input.workflowName !== "code-review") return { kind: "send", reason: "not-code-review" };
  if (!isAdvisoryReport(input.result)) return { kind: "send", reason: "not-advisory" };
  if (input.result.findings.length === 0) return { kind: "send", reason: "no-findings" };
  if (input.resultViewer === "skip") return { kind: "send", reason: "disabled" };
  if (input.mode !== "tui" || !input.hasUI) return { kind: "send", reason: "not-tui" };

  if (input.resultViewer !== "open") return { kind: "send", reason: "not-requested" };

  const issues = toReviewIssues(input.workflowName, input.result);
  return { kind: "open", report: input.result, issues, findingCount: issues.length };
}

export async function maybeShowReviewResultsViewer(
  ctx: ReviewResultsViewerContext,
  decision: ReviewResultsPresentationDecision,
): Promise<ReviewIssueSelection | undefined> {
  if (decision.kind !== "open") return undefined;

  return await ctx.ui.custom<ReviewIssueSelection>(
    (tui, theme, _keybindings, done) => new ReviewResultsViewer(decision.issues, "code-review", theme, () => tui.requestRender(), done),
    { overlay: true, overlayOptions: { anchor: "right-center", width: "80%", maxHeight: "90%", margin: 1 } },
  );
}

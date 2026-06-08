import assert from "node:assert/strict";
import { test } from "bun:test";
import type { AdvisoryReport } from "../.pi/extensions/pi-workflow-engine/src/advisory-schema.ts";
import {
  decideReviewResultsPresentation,
  maybeShowReviewResultsViewer,
  type ReviewResultsViewerContext,
} from "../.pi/extensions/pi-workflow-engine/src/review/review-results-flow.ts";
import type { ReviewIssueSelection } from "../.pi/extensions/pi-workflow-engine/src/review/review-issues.ts";

test("direct code-review sends results unless viewer is explicitly requested", () => {
  const notRequested = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "tui", hasUI: true });
  assert.deepEqual(notRequested, { kind: "send", reason: "not-requested" });

  const empty = decideReviewResultsPresentation({ workflowName: "code-review", result: { ...createReport(), findings: [] }, mode: "tui", hasUI: true });
  assert.deepEqual(empty, { kind: "send", reason: "no-findings" });

  const generic = decideReviewResultsPresentation({ workflowName: "refactor-scout", result: createReport(), mode: "tui", hasUI: true });
  assert.deepEqual(generic, { kind: "send", reason: "not-code-review" });

  const nonTui = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "rpc", hasUI: true });
  assert.deepEqual(nonTui, { kind: "send", reason: "not-tui" });
});

test("result viewer options can force open or skip", () => {
  const open = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "tui", hasUI: true, resultViewer: "open" });
  assert.equal(open.kind, "open");

  const skip = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "tui", hasUI: true, resultViewer: "skip" });
  assert.deepEqual(skip, { kind: "send", reason: "disabled" });
});

test("not-requested and non-TUI result flow never opens custom viewer", async () => {
  let customCalls = 0;
  const ctx: ReviewResultsViewerContext = {
    ui: {
      async custom<T>() {
        customCalls++;
        return { action: "close", issueIds: [] } as T;
      },
    },
  };

  const notRequested = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "tui", hasUI: true });
  const notOpened = await maybeShowReviewResultsViewer(ctx, notRequested);
  assert.equal(notOpened, undefined);
  assert.equal(customCalls, 0);

  const nonTui = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "rpc", hasUI: true, resultViewer: "open" });
  const skipped = await maybeShowReviewResultsViewer(ctx, nonTui);
  assert.equal(skipped, undefined);
  assert.equal(customCalls, 0);
});

test("forced-open direct code-review flow opens viewer and returns action before result message can be recorded", async () => {
  let customCalls = 0;
  const ctx: ReviewResultsViewerContext = {
    ui: {
      async custom<T>() {
        customCalls++;
        return { action: "close", issueIds: ["R001"] } as T;
      },
    },
  };
  const decision = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "tui", hasUI: true, resultViewer: "open" });
  const action = await maybeShowReviewResultsViewer(ctx, decision);

  assert.equal(customCalls, 1);
  assert.deepEqual(action, { action: "close", issueIds: ["R001"] } satisfies ReviewIssueSelection);
});

test("workflow tool execution path does not prompt or open a viewer", () => {
  const decision = decideReviewResultsPresentation({ workflowName: "code-review", result: createReport(), mode: "tui", hasUI: true, invocationKind: "tool" });
  assert.deepEqual(decision, { kind: "send", reason: "tool-invocation" });
});

function createReport(): AdvisoryReport {
  return {
    summary: "Review complete.",
    findings: [
      {
        summary: "Off-by-one in retry loop.",
        category: "bug",
        severity: "high",
        confidence: "high",
        locations: [{ file: "src/app.ts", line: 10, symbol: "retry" }],
        evidence: ["line 10 increments before checking the limit"],
        impact: "A final retry is skipped.",
        recommendation: "Change the loop boundary after adding a regression test.",
      },
    ],
    nextSteps: ["Inspect src/app.ts retry loop"],
  };
}

import assert from "node:assert/strict";
import { test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runWorkflow } from "../.pi/extensions/pi-workflow-engine/src/engine.ts";
import type { PerfSnapshot } from "../.pi/extensions/pi-workflow-engine/src/perf.ts";
import type { WorkflowProgressSnapshot } from "../.pi/extensions/pi-workflow-engine/src/progress.ts";
import type { WorkflowModule } from "../.pi/extensions/pi-workflow-engine/src/types.ts";

function fakeContext(signal?: AbortSignal): ExtensionContext {
  return {
    hasUI: false,
    cwd: process.cwd(),
    model: undefined,
    modelRegistry: { find: () => undefined },
    signal,
  } as unknown as ExtensionContext;
}

test("runWorkflow exposes a perf snapshot when perf is enabled", async () => {
  let snapshot: PerfSnapshot | undefined;
  const mod: WorkflowModule = {
    meta: { name: "perf-test", description: "perf" },
    default: async () => "ok",
  };

  const result = await runWorkflow(fakeContext(), mod, "", {
    perf: true,
    onPerfSnapshot: (value) => {
      snapshot = value;
    },
  });

  assert.equal(result, "ok");
  assert.equal(snapshot?.enabled, true);
  assert.ok(snapshot?.aggregates.some((aggregate) => aggregate.name === "workflow.total_ms"));
});

test("runWorkflow exposes a completed progress snapshot", async () => {
  let snapshot: WorkflowProgressSnapshot | undefined;
  const mod: WorkflowModule = {
    meta: { name: "progress-snapshot-test", description: "progress snapshot" },
    default: async (api) => {
      api.log("captured log entry");
      api.progress({ type: "summary", key: "kept", value: 1 });
      api.progress({ type: "lane_item", lane: "Findings", title: "Captured finding", status: "success", details: "expanded details" });
      return "ok";
    },
  };

  const result = await runWorkflow(fakeContext(), mod, "", {
    onProgressSnapshot: (value) => {
      snapshot = value;
    },
  });

  assert.equal(result, "ok");
  assert.equal(snapshot?.title, "progress-snapshot-test");
  assert.equal(typeof snapshot?.doneAt, "number");
  assert.deepEqual(snapshot?.summary, [["kept", 1]]);
  assert.equal(snapshot?.lanes[0]?.[0], "Findings");
  assert.equal(snapshot?.lanes[0]?.[1][0]?.details, "expanded details");
  assert.ok(snapshot?.logs.includes("captured log entry"));
});

test("runWorkflow composes an additional abort signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("tool aborted"));
  const mod: WorkflowModule = {
    meta: { name: "signal-test", description: "signal" },
    default: async (api) => {
      assert.equal(api.signal?.aborted, true);
      assert.match(String(api.signal?.reason), /tool aborted/);
      return "aborted signal visible";
    },
  };

  const result = await runWorkflow(fakeContext(), mod, "", { signal: controller.signal });
  assert.equal(result, "aborted signal visible");
});

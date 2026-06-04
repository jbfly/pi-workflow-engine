import assert from "node:assert/strict";
import { test } from "bun:test";
import { Type } from "typebox";
import { runAgent, type AgentProgress, type CreateAgentSession, type RunContext } from "../.pi/extensions/pi-workflow-engine/src/agent-runner.ts";
import { Semaphore } from "../.pi/extensions/pi-workflow-engine/src/concurrency.ts";
import { PerfRecorder } from "../.pi/extensions/pi-workflow-engine/src/perf.ts";

function createProgress(): AgentProgress & { readonly events: string[] } {
  const events: string[] = [];
  return {
    events,
    agentQueued(_phase, label) {
      events.push(`queued:${label}`);
      return events.length;
    },
    agentStart(_phase, label) {
      events.push(`start:${label}`);
    },
    agentTool(label, tool) {
      events.push(`tool:${label}:${tool}`);
    },
    agentDone(label) {
      events.push(`done:${label}`);
    },
    agentFailed(label, error) {
      events.push(`failed:${label}:${String(error)}`);
    },
    log(message) {
      events.push(`log:${message}`);
    },
  };
}

function aggregateNames(recorder: PerfRecorder): string[] {
  return recorder.snapshot().aggregates.map((aggregate) => aggregate.name).sort();
}

function createRunContext(createSession: CreateAgentSession, perf: PerfRecorder): RunContext {
  return {
    cwd: process.cwd(),
    hostModel: undefined,
    modelRegistry: { find: () => undefined },
    semaphore: new Semaphore(1),
    progress: createProgress(),
    signal: undefined,
    perf,
    createSession,
  };
}

test("runAgent records lifecycle timing samples without LLM calls", async () => {
  const perf = new PerfRecorder();
  let disposed = 0;
  const createSession: CreateAgentSession = async () => ({
    session: {
      state: { messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] },
      async prompt() {},
      subscribe() {
        return () => {};
      },
      dispose() {
        disposed += 1;
      },
      async abort() {},
    },
  });

  const result = await runAgent(createRunContext(createSession, perf), "hello", { label: "timed", phase: "Test" });

  assert.equal(result, "done");
  assert.equal(disposed, 1);
  assert.deepEqual(aggregateNames(perf), [
    "agent.create_session_ms",
    "agent.dispose_ms",
    "agent.extract_result_ms",
    "agent.prompt_ms",
    "agent.queue_wait_ms",
    "agent.total_ms",
  ]);
  const queueWait = perf.snapshot().aggregates.find((aggregate) => aggregate.name === "agent.queue_wait_ms");
  assert.equal(queueWait?.count, 1);
});

test("runAgent records missing structured output", async () => {
  const perf = new PerfRecorder();
  const createSession: CreateAgentSession = async () => ({
    session: {
      state: { messages: [] },
      async prompt() {},
      subscribe() {
        return () => {};
      },
      dispose() {},
      async abort() {},
    },
  });

  const result = await runAgent(createRunContext(createSession, perf), "hello", {
    label: "structured",
    schema: Type.Object({ ok: Type.Boolean() }),
  });

  assert.equal(result, null);
  assert.equal(perf.snapshot().aggregates.find((aggregate) => aggregate.name === "agent.structured_missing")?.total, 1);
});

// agent-log.ts — per-subagent activity logs on disk. [agent-harness patch]
//
// Each workflow run gets a dir under ~/.pi/agent/workflow-logs/<timestamp>/, and
// each subagent writes a human-readable <NN>-<label>.log there: the model it used,
// every tool call with its arguments, the agent's text, and its final output.
// Tail one live:  tail -f ~/.pi/agent/workflow-logs/<latest>/*.log
//
// All writes are best-effort and wrapped by callers in try/catch, so logging can
// never break a workflow.

import { mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// One log dir per run. Keyed by the shared RunContext object so every agent in a
// run lands in the same folder.
const RUN_DIRS = new WeakMap<object, string>();

export function runLogDir(runKey: object): string {
  let dir = RUN_DIRS.get(runKey);
  if (!dir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    dir = join(homedir(), ".pi", "agent", "workflow-logs", stamp);
    mkdirSync(dir, { recursive: true });
    RUN_DIRS.set(runKey, dir);
  }
  return dir;
}

export interface AgentLogger {
  readonly path: string;
  header(model: string, prompt: string): void;
  append(messages: readonly unknown[]): void;
  finalize(status: string, output: string): void;
}

export function createAgentLogger(runKey: object, label: string, rowId: number): AgentLogger | undefined {
  let file: string;
  try {
    const dir = runLogDir(runKey);
    const safe = label.replace(/[^\w.-]+/g, "_");
    file = join(dir, `${String(rowId).padStart(2, "0")}-${safe}.log`);
  } catch {
    return undefined;
  }
  let lastIndex = 0;
  const write = (s: string) => {
    try {
      appendFileSync(file, s);
    } catch {
      /* ignore */
    }
  };
  return {
    path: file,
    header(model, prompt) {
      write(
        `# agent: ${label}\n# model: ${model}\n# started: ${new Date().toISOString()}\n\n` +
          `## prompt\n${truncate(prompt, 4000)}\n\n## activity\n`,
      );
    },
    append(messages) {
      for (let i = lastIndex; i < messages.length; i++) write(renderMessage(messages[i]));
      lastIndex = messages.length;
    },
    finalize(status, output) {
      write(`\n## result (${status}) @ ${new Date().toISOString()}\n${truncate(output, 8000)}\n`);
    },
  };
}

export function modelDisplay(model: unknown, requested?: string): string {
  const m = model as { id?: string; name?: string; model?: string } | undefined;
  return m?.id ?? m?.name ?? m?.model ?? requested ?? "host model";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[${s.length - n} more chars]`;
}

// Defensive: message/content-part shapes vary by provider, so probe several field
// names rather than assume one schema.
function renderMessage(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const msg = message as { role?: string; content?: unknown; text?: string };
  const role = msg.role ?? "?";
  if (!Array.isArray(msg.content)) {
    return typeof msg.text === "string" && msg.text.trim() ? `[${role}] ${msg.text.trim()}\n` : "";
  }
  let out = "";
  for (const part of msg.content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = p.type;
    if (type === "text" && typeof p.text === "string" && p.text.trim()) {
      out += `[${role}] ${p.text.trim()}\n`;
    } else if ((type === "thinking" || type === "reasoning") && typeof (p.text ?? p.thinking) === "string") {
      out += `[${role}:thinking] ${truncate(String(p.text ?? p.thinking).trim(), 1500)}\n`;
    } else if (p.name || type === "tool_use" || type === "tool_call") {
      const input = p.input ?? p.args ?? p.arguments ?? p.parameters;
      out += `  → tool ${String(p.name ?? p.tool ?? "?")}: ${oneLine(input)}\n`;
    } else if (type === "tool_result" || type === "tool_use_result") {
      out += `  ← result: ${oneLine(p.content ?? p.output ?? p.result)}\n`;
    }
  }
  return out;
}

function oneLine(v: unknown): string {
  if (v == null) return "";
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return truncate(s.replace(/\s+/g, " ").trim(), 600);
}

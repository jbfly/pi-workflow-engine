import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { PerfSink } from "./perf.ts";

export interface AllowedDiffCommand {
  readonly file: "git" | "gh";
  readonly args: readonly string[];
}

export interface DiffCaptureResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly durationMs: number;
  readonly bytes: number;
  readonly error?: string;
}

export interface DiffCaptureOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxBufferBytes: number;
  readonly perf?: PerfSink;
  readonly env?: NodeJS.ProcessEnv;
  readonly killGraceMs?: number;
}

const SAFE_REF_OR_PATH = /^[A-Za-z0-9_./:@~+=,\-]+$/;
const SAFE_GH_FLAG = /^--[A-Za-z0-9-]+(=[A-Za-z0-9_./:@~+=,\-]+)?$/;
const SAFE_GIT_DIFF_FLAGS = new Set(["--cached", "--staged", "--no-color", "--color=never", "--no-ext-diff"]);

export function parseAllowedDiffCommand(command: string): AllowedDiffCommand | { error: string } {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { error: "empty or incomplete diff command" };
  if (tokens[0] === "git" && tokens[1] === "diff") return parseGitDiff(tokens);
  if (tokens[0] === "gh" && tokens[1] === "pr" && tokens[2] === "diff" && /^\d+$/.test(tokens[3] ?? "")) {
    const flags = tokens.slice(4);
    const unsafe = flags.find((token) => !SAFE_GH_FLAG.test(token));
    if (unsafe) return { error: `unsupported gh pr diff token: ${unsafe}` };
    return { file: "gh", args: ["pr", "diff", tokens[3], ...flags] };
  }
  return { error: "diff command is not in the git/gh allowlist" };
}

function parseGitDiff(tokens: readonly string[]): AllowedDiffCommand | { error: string } {
  const args = tokens.slice(2);
  const safeArgs = ["diff", "--no-ext-diff"];
  let pathMode = false;

  for (const token of args) {
    if (!SAFE_REF_OR_PATH.test(token)) return { error: `unsupported git diff token: ${token}` };
    if (token === "--") {
      pathMode = true;
      safeArgs.push(token);
      continue;
    }
    if (!pathMode && token.startsWith("-")) {
      if (!isAllowedGitDiffFlag(token)) return { error: `unsupported git diff option: ${token}` };
      if (token !== "--no-ext-diff") safeArgs.push(token);
      continue;
    }
    safeArgs.push(token);
  }

  return { file: "git", args: safeArgs };
}

function isAllowedGitDiffFlag(token: string): boolean {
  return SAFE_GIT_DIFF_FLAGS.has(token) || /^-U\d+$/.test(token) || /^--unified=\d+$/.test(token) || /^--inter-hunk-context=\d+$/.test(token);
}

export async function captureDiff(command: string, options: DiffCaptureOptions): Promise<DiffCaptureResult> {
  const parsed = parseAllowedDiffCommand(command);
  if ("error" in parsed) {
    return { ok: false, stdout: "", durationMs: 0, bytes: 0, error: parsed.error };
  }

  const start = performance.now();
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let error: string | undefined;
  const child = spawn(parsed.file, [...parsed.args], {
    cwd: options.cwd,
    env: diffCaptureEnv(options.env),
    stdio: ["ignore", "pipe", "pipe"],
  });

  return await new Promise<DiffCaptureResult>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const killGraceMs = Math.max(1, options.killGraceMs ?? 100);
    const finish = (ok: boolean, finishError?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      const durationMs = performance.now() - start;
      options.perf?.observe("diff.capture_ms", durationMs);
      options.perf?.observe("diff.bytes", bytes);
      resolve({ ok, stdout, durationMs, bytes, error: finishError });
    };
    const kill = (message: string) => {
      error = error ?? message;
      child.kill("SIGTERM");
      forceKillTimer ??= setTimeout(() => {
        child.kill("SIGKILL");
        finish(false, error);
      }, killGraceMs);
    };
    const onAbort = () => kill("diff capture aborted");
    const timeout = setTimeout(() => kill(`diff capture timed out after ${options.timeoutMs}ms`), options.timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    if (options.signal?.aborted) {
      kill("diff capture aborted");
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxBufferBytes) {
        kill(`diff capture exceeded ${options.maxBufferBytes} bytes`);
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (spawnError) => finish(false, spawnError.message));
    child.on("close", (code, signal) => {
      if (error) {
        finish(false, error);
        return;
      }
      if (code === 0) {
        finish(true);
        return;
      }
      finish(false, stderr.trim() || `diff command exited with code ${code ?? `signal ${signal ?? "unknown"}`}`);
    });
  });
}

function diffCaptureEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return { ...(env ?? process.env), GIT_EXTERNAL_DIFF: "", GIT_DIFF_OPTS: "" };
}

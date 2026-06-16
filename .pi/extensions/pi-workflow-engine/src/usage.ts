export interface WorkflowUsageCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

export interface WorkflowUsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost: WorkflowUsageCost;
}

export interface WorkflowAgentUsage {
  readonly label: string;
  readonly phase?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly assistantMessages: number;
  readonly usage: WorkflowUsageTotals;
}

export interface WorkflowUsageSnapshot {
  readonly agents: readonly WorkflowAgentUsage[];
  readonly totals: WorkflowUsageTotals;
  readonly assistantMessages: number;
}

export interface WorkflowUsageSink {
  recordAgentSession(input: { label: string; phase?: string; messages: readonly unknown[] }): void;
  snapshot(): WorkflowUsageSnapshot;
}

const ZERO_COST: WorkflowUsageCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const ZERO_TOTALS: WorkflowUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST };

interface AssistantUsageMessage {
  readonly provider?: string;
  readonly model?: string;
  readonly usage: WorkflowUsageTotals;
}

export class WorkflowUsageRecorder implements WorkflowUsageSink {
  private readonly agents: WorkflowAgentUsage[] = [];

  recordAgentSession(input: { label: string; phase?: string; messages: readonly unknown[] }): void {
    const assistantMessages = input.messages.flatMap((message) => {
      const parsed = parseAssistantUsageMessage(message);
      return parsed ? [parsed] : [];
    });
    if (assistantMessages.length === 0) return;

    const usage = sumTotals(assistantMessages.map((message) => message.usage));
    const latestMetadata = assistantMessages.findLast((message) => message.provider !== undefined || message.model !== undefined);
    this.agents.push({
      label: input.label,
      phase: input.phase,
      provider: latestMetadata?.provider,
      model: latestMetadata?.model,
      assistantMessages: assistantMessages.length,
      usage,
    });
  }

  snapshot(): WorkflowUsageSnapshot {
    const agents = this.agents.map((agent) => ({
      ...agent,
      usage: cloneTotals(agent.usage),
    }));
    return {
      agents,
      totals: sumTotals(agents.map((agent) => agent.usage)),
      assistantMessages: agents.reduce((sum, agent) => sum + agent.assistantMessages, 0),
    };
  }
}

export function createWorkflowUsageRecorder(): WorkflowUsageSink {
  return new WorkflowUsageRecorder();
}

export function emptyWorkflowUsageTotals(): WorkflowUsageTotals {
  return cloneTotals(ZERO_TOTALS);
}

export function isWorkflowUsageSnapshot(value: unknown): value is WorkflowUsageSnapshot {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.agents) || !value.agents.every(isWorkflowAgentUsage)) return false;
  if (!isWorkflowUsageTotals(value.totals)) return false;
  return finiteNumber(value.assistantMessages) !== undefined;
}

export function hasWorkflowUsage(snapshot: unknown): snapshot is WorkflowUsageSnapshot {
  if (!isWorkflowUsageSnapshot(snapshot)) return false;
  return snapshot.assistantMessages > 0 || snapshot.totals.totalTokens > 0 || snapshot.totals.cost.total > 0;
}

export function formatWorkflowUsageLine(snapshot: unknown): string | undefined {
  if (!hasWorkflowUsage(snapshot)) return undefined;
  const parts = [`↑${formatUsageCount(snapshot.totals.input)}`, `↓${formatUsageCount(snapshot.totals.output)}`];
  if (snapshot.totals.cacheRead > 0) parts.push(`R${formatUsageCount(snapshot.totals.cacheRead)}`);
  if (snapshot.totals.cacheWrite > 0) parts.push(`W${formatUsageCount(snapshot.totals.cacheWrite)}`);
  parts.push(`cost $${snapshot.totals.cost.total.toFixed(3)}`);
  parts.push(`agents ${snapshot.agents.length}`);
  return `Usage: ${parts.join(" · ")}`;
}

function isWorkflowAgentUsage(value: unknown): value is WorkflowAgentUsage {
  if (!isRecord(value)) return false;
  if (typeof value.label !== "string") return false;
  if (value.phase !== undefined && typeof value.phase !== "string") return false;
  if (value.provider !== undefined && typeof value.provider !== "string") return false;
  if (value.model !== undefined && typeof value.model !== "string") return false;
  if (finiteNumber(value.assistantMessages) === undefined) return false;
  return isWorkflowUsageTotals(value.usage);
}

function isWorkflowUsageTotals(value: unknown): value is WorkflowUsageTotals {
  if (!isRecord(value)) return false;
  if (finiteNumber(value.input) === undefined) return false;
  if (finiteNumber(value.output) === undefined) return false;
  if (finiteNumber(value.cacheRead) === undefined) return false;
  if (finiteNumber(value.cacheWrite) === undefined) return false;
  if (finiteNumber(value.totalTokens) === undefined) return false;
  return isWorkflowUsageCost(value.cost);
}

function isWorkflowUsageCost(value: unknown): value is WorkflowUsageCost {
  if (!isRecord(value)) return false;
  return (
    finiteNumber(value.input) !== undefined &&
    finiteNumber(value.output) !== undefined &&
    finiteNumber(value.cacheRead) !== undefined &&
    finiteNumber(value.cacheWrite) !== undefined &&
    finiteNumber(value.total) !== undefined
  );
}

function parseAssistantUsageMessage(message: unknown): AssistantUsageMessage | undefined {
  if (!isRecord(message)) return undefined;
  if (message.role !== "assistant") return undefined;
  const usage = parseUsageTotals(message.usage);
  if (!usage) return undefined;
  return {
    provider: typeof message.provider === "string" ? message.provider : undefined,
    model: typeof message.model === "string" ? message.model : undefined,
    usage,
  };
}

function parseUsageTotals(value: unknown): WorkflowUsageTotals | undefined {
  if (!isRecord(value)) return undefined;
  const input = finiteNumber(value.input);
  const output = finiteNumber(value.output);
  const cacheRead = finiteNumber(value.cacheRead);
  const cacheWrite = finiteNumber(value.cacheWrite);
  const cost = parseUsageCost(value.cost);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined || !cost) return undefined;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost,
  };
}

function parseUsageCost(value: unknown): WorkflowUsageCost | undefined {
  if (!isRecord(value)) return undefined;
  const input = finiteNumber(value.input);
  const output = finiteNumber(value.output);
  const cacheRead = finiteNumber(value.cacheRead);
  const cacheWrite = finiteNumber(value.cacheWrite);
  const total = finiteNumber(value.total);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined || total === undefined) return undefined;
  return { input, output, cacheRead, cacheWrite, total };
}

function sumTotals(values: readonly WorkflowUsageTotals[]): WorkflowUsageTotals {
  return values.reduce((sum, value) => addTotals(sum, value), emptyWorkflowUsageTotals());
}

function addTotals(left: WorkflowUsageTotals, right: WorkflowUsageTotals): WorkflowUsageTotals {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

function cloneTotals(value: WorkflowUsageTotals): WorkflowUsageTotals {
  return {
    input: value.input,
    output: value.output,
    cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite,
    totalTokens: value.totalTokens,
    cost: { ...value.cost },
  };
}

function formatUsageCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

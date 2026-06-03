import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Text } from "@earendil-works/pi-tui";
import { badge, formatCount } from "./workflow-format.ts";

export interface WorkflowResultEnvelope {
  name: string;
  result: unknown;
  completedAt: number;
}

export interface CodeReviewFinding {
  file: string;
  line?: number;
  severity?: string;
  verdict?: string;
  summary: string;
  evidence?: string;
  failure_scenario?: string;
}

export interface CodeReviewResult {
  summary: string;
  findings: CodeReviewFinding[];
  stats?: Record<string, string | number>;
}

export function isWorkflowResult(value: unknown): value is WorkflowResultEnvelope {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && "result" in value && typeof value.completedAt === "number";
}

export function isFinding(value: unknown): value is CodeReviewFinding {
  if (!isRecord(value)) return false;
  if (typeof value.file !== "string" || typeof value.summary !== "string") return false;
  if (value.line !== undefined && typeof value.line !== "number") return false;
  if (value.severity !== undefined && typeof value.severity !== "string") return false;
  if (value.verdict !== undefined && typeof value.verdict !== "string") return false;
  if (value.evidence !== undefined && typeof value.evidence !== "string") return false;
  if (value.failure_scenario !== undefined && typeof value.failure_scenario !== "string") return false;
  return true;
}

export function isCodeReviewResult(value: unknown): value is CodeReviewResult {
  if (!isRecord(value)) return false;
  if (typeof value.summary !== "string" || !Array.isArray(value.findings)) return false;
  if (!value.findings.every(isFinding)) return false;
  if (value.stats !== undefined && !isStats(value.stats)) return false;
  return true;
}

export function renderWorkflowResult(name: string, result: unknown, expanded: boolean, theme: Theme): Component {
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(renderWorkflowResultText(name, result, expanded, theme), 0, 0));
  return box;
}

export function renderWorkflowResultText(name: string, result: unknown, expanded: boolean, theme: Theme): string {
  if (name === "code-review" && isCodeReviewResult(result)) {
    return renderCodeReviewResult(name, result, expanded, theme);
  }
  return renderGenericWorkflowResult(name, result, expanded, theme);
}

function renderCodeReviewResult(name: string, result: CodeReviewResult, expanded: boolean, theme: Theme): string {
  const icon = theme.fg("success", "✓");
  const title = theme.fg("accent", theme.bold(`Workflow: ${name}`));
  const lines = [`${icon} ${title}`, theme.fg("muted", result.summary)];
  const stats = statsLine(result.stats, theme);
  if (stats) lines.push(stats);

  if (result.findings.length === 0) {
    lines.push(theme.fg("success", "No findings."));
    return lines.join("\n");
  }

  const findings = expanded ? result.findings : result.findings.slice(0, 3);
  lines.push(theme.fg("dim", expanded ? "Findings:" : "Top findings:"));
  for (const finding of findings) {
    lines.push(renderFinding(finding, expanded, theme));
  }
  if (!expanded && result.findings.length > findings.length) {
    lines.push(theme.fg("dim", `… ${result.findings.length - findings.length} more finding(s)`));
  }
  return lines.join("\n");
}

function renderFinding(finding: CodeReviewFinding, expanded: boolean, theme: Theme): string {
  const location = `${finding.file}${finding.line != null ? `:${finding.line}` : ""}`;
  const severityColor = finding.severity === "bug" ? "error" : "warning";
  const verdictColor = finding.verdict === "CONFIRMED" ? "success" : finding.verdict === "PLAUSIBLE" ? "warning" : "muted";
  let text =
    `  ${badge(finding.severity ?? "finding", severityColor, theme)} ` +
    `${badge(finding.verdict ?? "", verdictColor, theme)} ` +
    `${theme.fg("accent", location)} ${theme.fg("muted", finding.summary)}`;
  if (expanded) {
    if (finding.failure_scenario) text += `\n    ${theme.fg("dim", `Failure: ${finding.failure_scenario}`)}`;
    if (finding.evidence) text += `\n    ${theme.fg("dim", `Evidence: ${finding.evidence}`)}`;
  }
  return text;
}

function renderGenericWorkflowResult(name: string, result: unknown, expanded: boolean, theme: Theme): string {
  const lines = [`${theme.fg("success", "✓")} ${theme.fg("accent", theme.bold(`Workflow: ${name}`))}`];
  const summary = extractSummary(result);
  if (summary) lines.push(theme.fg("muted", summary));
  if (expanded) lines.push(theme.fg("dim", safeJson(result)));
  else if (!summary) lines.push(theme.fg("dim", compactJson(result)));
  return lines.join("\n");
}

function statsLine(stats: Record<string, string | number> | undefined, theme: Theme): string | undefined {
  if (!stats) return undefined;
  const ordered = ["files", "candidates", "dropped", "verified", "kept"];
  const parts = ordered.flatMap((key) => {
    const value = stats[key];
    if (value === undefined) return [];
    return [`${key} ${typeof value === "number" ? formatCount(value) : value}`];
  });
  if (parts.length === 0) return undefined;
  return theme.fg("dim", parts.join(" · "));
}

function extractSummary(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.summary === "string") return value.summary;
  return undefined;
}

function compactJson(value: unknown): string {
  const json = safeJson(value).replace(/\s+/g, " ").trim();
  return json.length > 240 ? `${json.slice(0, 237)}...` : json;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function isStats(value: unknown): value is Record<string, string | number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string" || typeof entry === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

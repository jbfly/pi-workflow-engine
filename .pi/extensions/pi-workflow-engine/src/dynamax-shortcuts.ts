import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

export const DEFAULT_DYNAMAX_INSPECTOR_SHORTCUT = "ctrl+shift+m" satisfies KeyId;

const CONFIG_FILE_NAME = "pi-workflow-engine.json";

export interface DynamaxShortcuts {
  inspector: KeyId | null;
}

interface DynamaxShortcutConfig {
  inspector?: unknown;
}

export function dynamaxShortcutsConfigPath(agentDir: string = getAgentDir()): string {
  return join(agentDir, "extensions", CONFIG_FILE_NAME);
}

export function resolveDynamaxShortcuts(configPath: string = dynamaxShortcutsConfigPath()): DynamaxShortcuts {
  if (!existsSync(configPath)) return defaultDynamaxShortcuts();

  const config = readShortcutConfig(configPath);
  if (!config) return defaultDynamaxShortcuts();

  return {
    inspector: shortcutFromConfig(config.inspector, DEFAULT_DYNAMAX_INSPECTOR_SHORTCUT),
  };
}

function readShortcutConfig(configPath: string): DynamaxShortcutConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    warnUsingDefaults("Could not read", configPath);
    return null;
  }

  const shortcuts = isRecord(parsed) ? parsed.shortcuts : undefined;
  if (shortcuts === undefined) return {};
  if (!isRecord(shortcuts) || !hasValidShortcutValues(shortcuts)) {
    warnUsingDefaults("Invalid", configPath);
    return null;
  }

  return shortcuts;
}

function hasValidShortcutValues(shortcuts: Record<string, unknown>): boolean {
  return isValidShortcutConfigValue(shortcuts.inspector);
}

function isValidShortcutConfigValue(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length > 0);
}

function shortcutFromConfig(configured: unknown, fallback: KeyId): KeyId | null {
  if (configured === null) return null;
  return typeof configured === "string" ? (configured.trim() as KeyId) : fallback;
}

function defaultDynamaxShortcuts(): DynamaxShortcuts {
  return { inspector: DEFAULT_DYNAMAX_INSPECTOR_SHORTCUT };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function warnUsingDefaults(reason: "Could not read" | "Invalid", configPath: string): void {
  console.warn(`${reason} pi-workflow-engine config at ${configPath}; using default Dynamax shortcuts.`);
}

import { saveCodexSettings } from "../db";
import { HttpError } from "../lib/http";
import { broadcastWorkspaceUpdated, resetInstanceState } from "./runtime";

export function updateCodexSettings(input: {
  responseLanguage?: string | null;
  defaultModel?: string | null;
  defaultReasoningEffort?: string | null;
}) {
  if (
    input.defaultReasoningEffort &&
    !["minimal", "low", "medium", "high", "xhigh"].includes(input.defaultReasoningEffort)
  ) {
    throw new HttpError(400, "Model reasoning effort must be one of: minimal, low, medium, high, xhigh.");
  }

  const settings = saveCodexSettings(input);
  broadcastWorkspaceUpdated();
  return settings;
}

export async function resetCodexWorkspaceState() {
  return resetInstanceState();
}

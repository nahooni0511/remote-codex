import type { Request, Response } from "express";

import { normalizeOptionalString } from "../lib/http";
import { resetCodexWorkspaceState, updateCodexSettings } from "../services/settings-service";

export function putCodexSettings(request: Request, response: Response) {
  const settings = updateCodexSettings({
    responseLanguage: normalizeOptionalString(request.body.responseLanguage),
    defaultModel: normalizeOptionalString(request.body.defaultModel),
    defaultReasoningEffort: normalizeOptionalString(request.body.defaultReasoningEffort),
  });

  response.json({ settings });
}

export async function postCodexSettingsReset(_request: Request, response: Response) {
  response.json({
    settings: await resetCodexWorkspaceState(),
  });
}

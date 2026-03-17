import { Router } from "express";

import { saveCodexSettings } from "../db";
import { HttpError, normalizeOptionalString } from "../lib/http";
import { broadcastWorkspaceUpdated, resetInstanceState } from "../services/runtime";

export const settingsRouter = Router();

settingsRouter.put("/api/settings/codex", (request, response, next) => {
  try {
    const responseLanguage = normalizeOptionalString(request.body.responseLanguage);
    const defaultModel = normalizeOptionalString(request.body.defaultModel);
    const defaultReasoningEffort = normalizeOptionalString(request.body.defaultReasoningEffort);

    if (
      defaultReasoningEffort &&
      !["minimal", "low", "medium", "high", "xhigh"].includes(defaultReasoningEffort)
    ) {
      throw new HttpError(400, "Model reasoning effort must be one of: minimal, low, medium, high, xhigh.");
    }

    const settings = saveCodexSettings({
      responseLanguage,
      defaultModel,
      defaultReasoningEffort,
    });

    broadcastWorkspaceUpdated();
    response.json({ settings });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post("/api/settings/codex/reset", async (_request, response, next) => {
  try {
    response.json({
      settings: await resetInstanceState(),
    });
  } catch (error) {
    next(error);
  }
});

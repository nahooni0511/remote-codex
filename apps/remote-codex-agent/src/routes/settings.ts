import { Router } from "express";

import { postCodexSettingsReset, putCodexSettings } from "../controllers/settings-controller";
import { createRouteHandler } from "../controllers/route-handler";

export const settingsRouter = Router();

settingsRouter.put("/api/settings/codex", createRouteHandler(putCodexSettings));
settingsRouter.post("/api/settings/codex/reset", createRouteHandler(postCodexSettingsReset));

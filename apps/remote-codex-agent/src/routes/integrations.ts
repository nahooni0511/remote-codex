import { Router } from "express";

import {
  claimGlobalPairing,
  createGlobalIntegration,
  deleteGlobalIntegration,
  deleteTelegramIntegration,
  getIntegrations,
} from "../controllers/integrations-controller";
import { createRouteHandler } from "../controllers/route-handler";

export const integrationsRouter = Router();

integrationsRouter.get("/api/integrations", createRouteHandler(getIntegrations));
integrationsRouter.post("/api/integrations/global", createRouteHandler(createGlobalIntegration));
integrationsRouter.post("/api/integrations/global/claim", createRouteHandler(claimGlobalPairing));
integrationsRouter.delete("/api/integrations/global", createRouteHandler(deleteGlobalIntegration));
integrationsRouter.delete("/api/integrations/telegram", createRouteHandler(deleteTelegramIntegration));

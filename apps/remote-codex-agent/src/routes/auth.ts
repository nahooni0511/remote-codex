import { Router } from "express";

import {
  sendTelegramAuthCode,
  verifyTelegramCode,
  verifyTelegramPassword,
} from "../controllers/auth-controller";
import { createRouteHandler } from "../controllers/route-handler";

export const authRouter = Router();

authRouter.post("/api/auth/send-code", createRouteHandler(sendTelegramAuthCode));
authRouter.post("/api/auth/verify-code", createRouteHandler(verifyTelegramCode));
authRouter.post("/api/auth/verify-password", createRouteHandler(verifyTelegramPassword));

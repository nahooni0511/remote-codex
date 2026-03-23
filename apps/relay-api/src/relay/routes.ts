import type { Express } from "express";

import { createRelayAuthController } from "./controllers/auth-controller";
import { createRelayDeviceController } from "./controllers/device-controller";
import { createHealthController } from "./controllers/health-controller";
import { createRelayPairingController } from "./controllers/pairing-controller";
import { createRouteHandler } from "./controllers/route-handler";
import { createRelayAuthService } from "./services/auth-service";
import { createRelayDeviceService } from "./services/device-service";
import { createRelayPairingService } from "./services/pairing-service";
import type { RelayStore } from "./store";

export function registerRelayRoutes(app: Express, options: { port: number; store: RelayStore }) {
  const healthController = createHealthController();
  const authController = createRelayAuthController(createRelayAuthService(options));
  const deviceController = createRelayDeviceController(createRelayDeviceService(options));
  const pairingController = createRelayPairingController(createRelayPairingService(options));

  app.get("/api/health", createRouteHandler(healthController.getHealth));
  app.get("/api/session", createRouteHandler(authController.getSession));
  app.get("/api/auth/config", createRouteHandler(authController.getConfig));
  app.post("/api/auth/oidc/exchange", createRouteHandler(authController.exchangeOidc));
  app.get("/api/auth/local/setup-status", createRouteHandler(authController.getLocalSetupStatus));
  app.post("/api/auth/local/setup", createRouteHandler(authController.setupLocalAdmin));
  app.post("/api/auth/local/login", createRouteHandler(authController.loginLocalAdmin));
  app.post("/api/auth/refresh", createRouteHandler(authController.refreshSession));
  app.post("/api/auth/logout", createRouteHandler(authController.logout));

  app.get("/api/devices", createRouteHandler(deviceController.listDevices));
  app.post("/api/devices/:deviceId/connect-token", createRouteHandler(deviceController.createConnectToken));
  app.post("/api/devices/:deviceId/update/check", createRouteHandler(deviceController.checkDeviceUpdate));
  app.post("/api/devices/:deviceId/update/apply", createRouteHandler(deviceController.applyDeviceUpdate));

  app.post("/api/pairing-codes", createRouteHandler(pairingController.createPairingCode));
  app.post("/api/pairing-codes/:code/claim", createRouteHandler(pairingController.claimPairingCode));
}

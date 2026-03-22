import type { Express } from "express";
import type {
  DeviceConnectTokenResponse,
  PairingCodeClaimRequest,
  PairingCodeClaimResponse,
  PairingCodeCreateResponse,
  RelayAuthExchangeResponse,
  RelayLocalLoginRequest,
  RelayLocalSetupRequest,
  RelayLogoutRequest,
  RelayOidcExchangeRequest,
  RelayRefreshRequest,
} from "@remote-codex/contracts";

import type { RelayStore } from "./store";
import { buildWsUrl, getRequestBaseUrl } from "./helpers";

export function registerRelayRoutes(app: Express, options: { port: number; store: RelayStore }) {
  const { port, store } = options;

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "relay-api",
      now: new Date().toISOString(),
    });
  });

  app.get("/api/session", async (request, response) => {
    response.json(store.serializeRelaySession(await store.getSessionFromRequest(request)));
  });

  app.get("/api/auth/config", async (request, response) => {
    response.json(await store.getClientAuthConfig(getRequestBaseUrl(request, port)));
  });

  app.post("/api/auth/oidc/exchange", async (request, response) => {
    const body = request.body as RelayOidcExchangeRequest | undefined;
    if (!body?.methodId || !body.idToken) {
      response.status(400).json({ error: "methodId and idToken are required." });
      return;
    }

    try {
      const payload: RelayAuthExchangeResponse = await store.exchangeOidcIdToken(body.methodId, body.idToken);
      response.status(201).json(payload);
    } catch (error) {
      response.status(401).json({ error: error instanceof Error ? error.message : "OIDC exchange failed." });
    }
  });

  app.get("/api/auth/local/setup-status", async (request, response) => {
    const methodId = typeof request.query.methodId === "string" ? request.query.methodId.trim() : "";
    if (!methodId) {
      response.status(400).json({ error: "methodId is required." });
      return;
    }

    try {
      response.json(await store.getLocalAdminSetupStatus(methodId));
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : "Local admin auth is unavailable." });
    }
  });

  app.post("/api/auth/local/setup", async (request, response) => {
    const body = request.body as RelayLocalSetupRequest | undefined;
    if (!body?.methodId || !body.email || !body.password || !body.bootstrapToken) {
      response.status(400).json({ error: "methodId, email, password, and bootstrapToken are required." });
      return;
    }

    try {
      const payload: RelayAuthExchangeResponse = await store.localAdminSetup(
        body.methodId,
        body.email,
        body.password,
        body.bootstrapToken,
      );
      response.status(201).json(payload);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Local admin setup failed." });
    }
  });

  app.post("/api/auth/local/login", async (request, response) => {
    const body = request.body as RelayLocalLoginRequest | undefined;
    if (!body?.methodId || !body.email || !body.password) {
      response.status(400).json({ error: "methodId, email, and password are required." });
      return;
    }

    try {
      const payload: RelayAuthExchangeResponse = await store.localAdminLogin(body.methodId, body.email, body.password);
      response.status(201).json(payload);
    } catch (error) {
      response.status(401).json({ error: error instanceof Error ? error.message : "Local admin sign-in failed." });
    }
  });

  app.post("/api/auth/refresh", async (request, response) => {
    const body = request.body as RelayRefreshRequest | undefined;
    if (!body?.refreshToken) {
      response.status(400).json({ error: "refreshToken is required." });
      return;
    }

    try {
      const payload: RelayAuthExchangeResponse = await store.refreshAuthSession(body.refreshToken);
      response.status(201).json(payload);
    } catch (error) {
      response.status(401).json({ error: error instanceof Error ? error.message : "Refresh failed." });
    }
  });

  app.post("/api/auth/logout", async (request, response) => {
    const body = request.body as RelayLogoutRequest | undefined;
    await store.logoutSession(body?.refreshToken || null);
    response.status(204).end();
  });

  app.get("/api/devices", async (request, response) => {
    const session = await store.requireSession(request, response);
    if (!session) {
      return;
    }

    response.json({
      devices: await store.listDevicesForSession(session),
    });
  });

  app.post("/api/devices/:deviceId/connect-token", async (request, response) => {
    const session = await store.requireSession(request, response);
    if (!session) {
      return;
    }

    const device = await store.assertDeviceAccess(session, request.params.deviceId);
    if (!device) {
      response.status(404).json({ error: "Device not found." });
      return;
    }

    const tokenRecord = await store.createConnectToken(session, device.deviceId);
    const payload: DeviceConnectTokenResponse = {
      token: tokenRecord.token,
      wsUrl: buildWsUrl(getRequestBaseUrl(request, port)),
      expiresAt: tokenRecord.expiresAt,
      device,
    };
    response.json(payload);
  });

  app.post("/api/devices/:deviceId/update/check", async (request, response) => {
    const session = await store.requireSession(request, response);
    if (!session) {
      return;
    }

    const device = await store.assertDeviceAccess(session, request.params.deviceId);
    if (!device) {
      response.status(404).json({ error: "Device not found." });
      return;
    }

    response.json(await store.sendUpdateRpc(device.deviceId, "system.update.check"));
  });

  app.post("/api/devices/:deviceId/update/apply", async (request, response) => {
    const session = await store.requireSession(request, response);
    if (!session) {
      return;
    }

    const device = await store.assertDeviceAccess(session, request.params.deviceId);
    if (!device) {
      response.status(404).json({ error: "Device not found." });
      return;
    }

    response.json(await store.sendUpdateRpc(device.deviceId, "system.update.apply"));
  });

  app.post("/api/pairing-codes", async (request, response) => {
    const session = await store.requireSession(request, response);
    if (!session) {
      return;
    }

    const ownerLabel =
      (typeof request.body?.ownerLabel === "string" && request.body.ownerLabel.trim()) || session.user.email;
    const payload: PairingCodeCreateResponse = await store.createPairingCode(session, ownerLabel);
    response.status(201).json(payload);
  });

  app.post("/api/pairing-codes/:code/claim", async (request, response) => {
    const code = typeof request.params.code === "string" ? request.params.code.trim().toUpperCase() : "";
    if (!code) {
      response.status(400).json({ error: "Pairing code is required." });
      return;
    }

    const body = request.body as PairingCodeClaimRequest | undefined;
    if (!body?.device?.localDeviceId || !body.devicePublicKey || !body.protocolVersion || !body.minSupportedProtocol) {
      response.status(400).json({ error: "Incomplete pairing claim payload." });
      return;
    }

    try {
      const payload: PairingCodeClaimResponse = await store.claimPairingCode(code, body, request);
      response.status(201).json(payload);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Pairing claim failed.",
      });
    }
  });
}

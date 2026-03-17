import type { Express } from "express";
import type {
  DeviceConnectTokenResponse,
  PairingCodeClaimRequest,
  PairingCodeClaimResponse,
  PairingCodeCreateResponse,
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

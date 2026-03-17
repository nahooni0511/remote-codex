import { Router } from "express";
import type { PairingCodeClaimResponse, PairingCodeClaimRequest } from "@remote-codex/contracts";

import {
  getDeviceProfile,
  clearGlobalPairing,
  clearTelegramAuth,
  getGlobalPairing,
  getTelegramAuth,
  saveGlobalPairing,
} from "../db";
import { normalizeRelayServerUrl } from "../lib/relay";
import { broadcastWorkspaceUpdated, clearTelegramRuntimeState, refreshRelayBridgeConnection } from "../services/runtime";
import { getOrCreateRelayKeys } from "../services/relay-bridge/crypto";

export const integrationsRouter = Router();

integrationsRouter.get("/api/integrations", (_request, response) => {
  const telegram = getTelegramAuth();
  const globalPairing = getGlobalPairing();

  response.json({
    telegram: {
      enabled: telegram.isAuthenticated,
      connected: telegram.isAuthenticated,
      phoneNumber: telegram.phoneNumber,
      userName: telegram.userName,
      botUserName: telegram.botUserName,
    },
    global: {
      enabled: Boolean(globalPairing?.enabled),
      paired: Boolean(globalPairing?.deviceId),
      connected: Boolean(globalPairing?.connected),
      deviceId: globalPairing?.deviceId || null,
      ownerLabel: globalPairing?.ownerLabel || null,
      serverUrl: globalPairing?.serverUrl || null,
      lastSyncAt: globalPairing?.lastSyncAt || null,
    },
  });
});

integrationsRouter.post("/api/integrations/global", (request, response) => {
  let serverUrl: string | null = null;
  if (typeof request.body?.serverUrl === "string" && request.body.serverUrl.trim()) {
    try {
      serverUrl = normalizeRelayServerUrl(request.body.serverUrl);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Invalid relay server URL." });
      return;
    }
  }

  const pairing = saveGlobalPairing({
    enabled: request.body?.enabled !== false,
    deviceId: typeof request.body?.deviceId === "string" ? request.body.deviceId.trim() || null : null,
    deviceSecret:
      typeof request.body?.deviceSecret === "string" ? request.body.deviceSecret.trim() || null : null,
    ownerLabel: typeof request.body?.ownerLabel === "string" ? request.body.ownerLabel.trim() || null : null,
    serverUrl,
    wsUrl: typeof request.body?.wsUrl === "string" ? request.body.wsUrl.trim() || null : null,
    connected: Boolean(request.body?.connected),
    lastSyncAt: typeof request.body?.lastSyncAt === "string" ? request.body.lastSyncAt : null,
  });

  refreshRelayBridgeConnection();
  broadcastWorkspaceUpdated();
  response.status(201).json({ global: pairing });
});

integrationsRouter.post("/api/integrations/global/claim", async (request, response, next) => {
  const pairingCode = typeof request.body?.pairingCode === "string" ? request.body.pairingCode.trim().toUpperCase() : "";
  const serverUrlInput = typeof request.body?.serverUrl === "string" ? request.body.serverUrl : "";
  let serverUrl = "";

  try {
    serverUrl = serverUrlInput.trim() ? normalizeRelayServerUrl(serverUrlInput) : "";
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid relay server URL." });
    return;
  }

  try {
    if (!pairingCode || !serverUrl) {
      response.status(400).json({ error: "pairingCode and serverUrl are required." });
      return;
    }

    const device = getDeviceProfile();
    const relayKeys = getOrCreateRelayKeys();
    const claimPayload: PairingCodeClaimRequest = {
      device,
      devicePublicKey: relayKeys.publicKey,
      protocolVersion: process.env.REMOTE_CODEX_RELAY_PROTOCOL_VERSION?.trim() || "1.0.0",
      minSupportedProtocol: process.env.REMOTE_CODEX_RELAY_PROTOCOL_VERSION?.trim() || "1.0.0",
    };

    const claimResponse = await fetch(`${serverUrl}/api/pairing-codes/${encodeURIComponent(pairingCode)}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(claimPayload),
    });
    if (!claimResponse.ok) {
      throw new Error(await claimResponse.text());
    }

    const claimed = (await claimResponse.json()) as PairingCodeClaimResponse;
    const pairing = saveGlobalPairing({
      enabled: true,
      deviceId: claimed.deviceId,
      deviceSecret: claimed.deviceSecret,
      ownerLabel: claimed.ownerLabel,
      serverUrl: normalizeRelayServerUrl(claimed.serverUrl),
      wsUrl: claimed.wsUrl,
      connected: false,
      lastSyncAt: null,
    });

    refreshRelayBridgeConnection();
    broadcastWorkspaceUpdated();
    response.status(201).json({ global: pairing });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.delete("/api/integrations/global", (_request, response) => {
  clearGlobalPairing();
  refreshRelayBridgeConnection();
  broadcastWorkspaceUpdated();
  response.status(204).end();
});

integrationsRouter.delete("/api/integrations/telegram", async (_request, response, next) => {
  try {
    clearTelegramAuth();
    await clearTelegramRuntimeState();
    broadcastWorkspaceUpdated();
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

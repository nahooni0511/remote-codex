import type { PairingCodeClaimRequest, PairingCodeClaimResponse } from "@remote-codex/contracts";

import {
  clearGlobalPairing,
  clearTelegramAuth,
  getDeviceProfile,
  getGlobalPairing,
  getTelegramAuth,
  saveGlobalPairing,
} from "../db";
import { HttpError } from "../lib/http";
import { normalizeRelayServerUrl } from "../lib/relay";
import {
  broadcastWorkspaceUpdated,
  clearTelegramRuntimeState,
  refreshRelayBridgeConnection,
} from "./runtime";
import { getOrCreateRelayKeys } from "./relay-bridge/crypto";

export function getIntegrationsSummary() {
  const telegram = getTelegramAuth();
  const globalPairing = getGlobalPairing();

  return {
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
  };
}

export function saveGlobalIntegration(input: {
  enabled?: boolean;
  deviceId?: string | null;
  deviceSecret?: string | null;
  ownerLabel?: string | null;
  serverUrl?: string | null;
  wsUrl?: string | null;
  connected?: boolean;
  lastSyncAt?: string | null;
}) {
  let serverUrl: string | null = null;
  if (input.serverUrl?.trim()) {
    try {
      serverUrl = normalizeRelayServerUrl(input.serverUrl);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid relay server URL.");
    }
  }

  const pairing = saveGlobalPairing({
    enabled: input.enabled !== false,
    deviceId: input.deviceId?.trim() || null,
    deviceSecret: input.deviceSecret?.trim() || null,
    ownerLabel: input.ownerLabel?.trim() || null,
    serverUrl,
    wsUrl: input.wsUrl?.trim() || null,
    connected: Boolean(input.connected),
    lastSyncAt: input.lastSyncAt ?? null,
  });

  refreshRelayBridgeConnection();
  broadcastWorkspaceUpdated();
  return pairing;
}

export async function claimGlobalIntegration(input: { pairingCode: string; serverUrl: string }) {
  const pairingCode = input.pairingCode.trim().toUpperCase();
  const serverUrlInput = input.serverUrl.trim();

  if (!pairingCode || !serverUrlInput) {
    throw new HttpError(400, "pairingCode and serverUrl are required.");
  }

  let serverUrl: string;
  try {
    serverUrl = normalizeRelayServerUrl(serverUrlInput);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid relay server URL.");
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
  return pairing;
}

export function clearGlobalIntegration() {
  clearGlobalPairing();
  refreshRelayBridgeConnection();
  broadcastWorkspaceUpdated();
}

export async function clearTelegramIntegration() {
  clearTelegramAuth();
  await clearTelegramRuntimeState();
  broadcastWorkspaceUpdated();
}

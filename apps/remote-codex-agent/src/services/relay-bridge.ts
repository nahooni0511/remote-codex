import { WebSocket } from "ws";
import type {
  AppUpdateApplyResult,
  AppUpdateStatus,
  BridgeHttpResponsePayload,
  BridgeMessage,
  BridgeRealtimePayload,
  RealtimeEvent,
} from "@remote-codex/contracts";

import { getDeviceProfile, getGlobalPairing, nowIso, saveGlobalPairing } from "../db";
import { decryptRelayPayload, encryptRelayPayload, getOrCreateRelayKeys } from "./relay-bridge/crypto";
import { handleRelayTunnelRequest } from "./relay-bridge/tunnel";

const RELAY_PROTOCOL_VERSION = process.env.REMOTE_CODEX_RELAY_PROTOCOL_VERSION?.trim() || "1.0.0";
const RELAY_HEARTBEAT_MS = 30_000;

type RelayBridgeOptions = {
  port: number;
  handleUpdateRpc: (method: "system.update.check" | "system.update.apply") => Promise<AppUpdateStatus | AppUpdateApplyResult>;
};

let relayOptions: RelayBridgeOptions | null = null;
let relaySocket: WebSocket | null = null;
let relayReconnectTimer: NodeJS.Timeout | null = null;
let relayHeartbeatTimer: NodeJS.Timeout | null = null;
let relayStopped = false;
const activeRelayClients = new Map<string, string>();

function buildRelayWsUrl(): string | null {
  const pairing = getGlobalPairing();
  if (!pairing?.enabled) {
    return null;
  }

  if (pairing.wsUrl) {
    return pairing.wsUrl;
  }

  if (!pairing.serverUrl) {
    return null;
  }

  const url = new URL(pairing.serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/bridge";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function clearReconnectTimer(): void {
  if (!relayReconnectTimer) {
    return;
  }

  clearTimeout(relayReconnectTimer);
  relayReconnectTimer = null;
}

function clearHeartbeatTimer(): void {
  if (!relayHeartbeatTimer) {
    return;
  }

  clearInterval(relayHeartbeatTimer);
  relayHeartbeatTimer = null;
}

function scheduleReconnect(delayMs = 1_500): void {
  if (relayStopped) {
    return;
  }

  clearReconnectTimer();
  relayReconnectTimer = setTimeout(() => {
    relayReconnectTimer = null;
    void ensureRelayBridgeConnection();
  }, delayMs);
}

function markRelayConnected(connected: boolean): void {
  const pairing = getGlobalPairing();
  if (!pairing) {
    return;
  }

  saveGlobalPairing({
    connected,
    lastSyncAt: connected ? nowIso() : pairing.lastSyncAt,
  });
}

function sendBridgeMessage(message: BridgeMessage): void {
  if (relaySocket?.readyState !== WebSocket.OPEN) {
    return;
  }

  relaySocket.send(JSON.stringify(message));
}

function clearActiveRelayClients(): void {
  activeRelayClients.clear();
}

async function handleBridgeMessage(message: BridgeMessage): Promise<void> {
  if (message.type === "ping") {
    sendBridgeMessage({ type: "pong", at: nowIso() });
    return;
  }

  if (message.type === "client.attached") {
    activeRelayClients.set(message.sessionId, message.clientPublicKey);
    return;
  }

  if (message.type === "client.detached") {
    activeRelayClients.delete(message.sessionId);
    return;
  }

  if (message.type === "rpc.request") {
    if (!relayOptions) {
      return;
    }

    if (message.method !== "system.update.check" && message.method !== "system.update.apply") {
      sendBridgeMessage({
        type: "rpc.response",
        requestId: message.requestId,
        ok: false,
        error: `Unsupported relay RPC method: ${message.method}`,
      });
      return;
    }

    try {
      const payload = await relayOptions.handleUpdateRpc(message.method);
      sendBridgeMessage({
        type: "rpc.response",
        requestId: message.requestId,
        ok: true,
        payload,
      });
    } catch (error) {
      sendBridgeMessage({
        type: "rpc.response",
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Relay RPC failed.",
      });
    }
    return;
  }

  if (message.type !== "bridge.envelope") {
    return;
  }

  const keys = getOrCreateRelayKeys();
  const decrypted = decryptRelayPayload({
    payload: message.envelope.payload,
    secretKey: keys.secretKey,
  });

  if (decrypted.kind !== "http.request") {
    return;
  }

  const options = relayOptions;
  if (!options) {
    throw new Error("Relay bridge is not configured.");
  }

  let responsePayload: BridgeHttpResponsePayload;
  try {
    responsePayload = await handleRelayTunnelRequest({
      port: options.port,
      request: decrypted,
    });
  } catch (error) {
    responsePayload = {
      kind: "http.response",
      requestId: decrypted.requestId,
      status: 500,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Relay tunnel request failed.",
      }),
      bodyEncoding: "utf8",
    };
  }

  sendBridgeMessage({
    type: "bridge.envelope",
    envelope: {
      sessionId: message.envelope.sessionId,
      deviceId: message.envelope.deviceId,
      payload: encryptRelayPayload({
        data: responsePayload,
        senderPublicKey: keys.publicKey,
        senderSecretKey: keys.secretKey,
        recipientPublicKey: message.envelope.payload.senderPublicKey,
      }),
    },
  });
}

export function publishRelayRealtimeEvent(event: RealtimeEvent): void {
  if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN || !activeRelayClients.size) {
    return;
  }

  const keys = getOrCreateRelayKeys();
  for (const [sessionId, clientPublicKey] of activeRelayClients.entries()) {
    const payload: BridgeRealtimePayload = {
      kind: "realtime.event",
      event,
    };
    sendBridgeMessage({
      type: "bridge.envelope",
      envelope: {
        sessionId,
        deviceId: getGlobalPairing()?.deviceId || "",
        payload: encryptRelayPayload({
          data: payload,
          senderPublicKey: keys.publicKey,
          senderSecretKey: keys.secretKey,
          recipientPublicKey: clientPublicKey,
        }),
      },
    });
  }
}

export async function ensureRelayBridgeConnection(): Promise<void> {
  if (!relayOptions || relayStopped) {
    return;
  }

  const pairing = getGlobalPairing();
  const wsUrl = buildRelayWsUrl();
  if (!pairing?.enabled || !pairing.deviceId || !pairing.deviceSecret || !wsUrl) {
    relaySocket?.close();
    relaySocket = null;
    clearHeartbeatTimer();
    clearActiveRelayClients();
    markRelayConnected(false);
    return;
  }
  const pairingConfig = pairing;

  if (relaySocket && (relaySocket.readyState === WebSocket.OPEN || relaySocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const keys = getOrCreateRelayKeys();
  const device = getDeviceProfile();
  const socket = new WebSocket(wsUrl);
  relaySocket = socket;

  socket.on("open", () => {
    clearReconnectTimer();
    clearHeartbeatTimer();
    clearActiveRelayClients();
    markRelayConnected(true);
    sendBridgeMessage({
      type: "device.hello",
      deviceId: pairingConfig.deviceId!,
      deviceSecret: pairingConfig.deviceSecret!,
      protocolVersion: RELAY_PROTOCOL_VERSION,
      minSupportedProtocol: RELAY_PROTOCOL_VERSION,
      devicePublicKey: keys.publicKey,
      ownerEmail: pairingConfig.ownerLabel,
      appVersion: device.appVersion,
      payload: device,
    });

    relayHeartbeatTimer = setInterval(() => {
      sendBridgeMessage({ type: "ping", at: nowIso() });
    }, RELAY_HEARTBEAT_MS);
  });

  socket.on("message", (data) => {
    void handleBridgeMessage(JSON.parse(String(data)) as BridgeMessage).catch((error) => {
      console.error("Relay bridge message handling failed:", error);
    });
  });

  socket.on("close", () => {
    if (relaySocket === socket) {
      relaySocket = null;
    }
    clearHeartbeatTimer();
    clearActiveRelayClients();
    markRelayConnected(false);
    scheduleReconnect();
  });

  socket.on("error", () => {
    socket.close();
  });
}

export function configureRelayBridgeService(options: RelayBridgeOptions): void {
  relayOptions = options;
}

export function startRelayBridgeService(): void {
  relayStopped = false;
  void ensureRelayBridgeConnection();
}

export function stopRelayBridgeService(): void {
  relayStopped = true;
  clearReconnectTimer();
  clearHeartbeatTimer();
  clearActiveRelayClients();
  relaySocket?.close();
  relaySocket = null;
  markRelayConnected(false);
}

export function refreshRelayBridgeConnection(): void {
  if (relaySocket) {
    relaySocket.close();
  } else {
    scheduleReconnect(10);
  }
}

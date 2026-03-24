import type { Server as HttpServer } from "node:http";

import type { RelayAuthUser } from "@remote-codex/contracts";
import { WebSocketServer } from "ws";
import type { BridgeMessage } from "@remote-codex/contracts";

import type { RelayStore } from "./store";
import {
  SUBSCRIPTION_REQUIRED_CODE,
  type RevenueCatService,
} from "./services/revenuecat-service";

const BILLING_CACHE_TTL_MS = 5_000;

type BillingCacheEntry = {
  allowed: boolean;
  expiresAt: number;
  pending: Promise<boolean> | null;
};

function createBillingAccessGuard(revenueCat: RevenueCatService) {
  const cache = new Map<string, BillingCacheEntry>();

  return async (user: RelayAuthUser): Promise<boolean> => {
    if (!revenueCat.isConfigured()) {
      return true;
    }

    const cached = cache.get(user.id);
    if (cached?.pending) {
      return cached.pending;
    }

    if (cached && cached.expiresAt > Date.now()) {
      return cached.allowed;
    }

    const pending = revenueCat
      .getBillingStatus(user)
      .then((billing) => {
        const allowed = !billing.enabled || billing.active;
        cache.set(user.id, {
          allowed,
          expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
          pending: null,
        });
        return allowed;
      })
      .catch((error) => {
        cache.delete(user.id);
        throw error;
      });

    cache.set(user.id, {
      allowed: cached?.allowed ?? false,
      expiresAt: 0,
      pending,
    });
    return pending;
  };
}

export function attachRelayWebSocketServer(server: HttpServer, store: RelayStore, revenueCat: RevenueCatService) {
  const wsServer = new WebSocketServer({ server, path: "/ws/bridge" });
  const hasBillingAccess = createBillingAccessGuard(revenueCat);

  wsServer.on("connection", (socket) => {
    let role: "device" | "client" | null = null;
    let deviceId: string | null = null;
    let clientToken: string | null = null;
    let clientUser: RelayAuthUser | null = null;

    const rejectInactiveSubscription = async () => {
      if (!clientUser) {
        return false;
      }

      const allowed = await hasBillingAccess(clientUser);
      if (allowed) {
        return false;
      }

      store.sendBridgeMessage(socket, {
        type: "bridge.error",
        code: SUBSCRIPTION_REQUIRED_CODE,
        error: "Active subscription required to access remote workspaces.",
      });
      socket.close();
      return true;
    };

    socket.on("message", (data) => {
      void (async () => {
        const message = JSON.parse(String(data)) as BridgeMessage;

        if (message.type === "device.hello") {
          try {
            role = "device";
            deviceId = message.deviceId;
            await store.registerDeviceConnection({ socket, message });
            store.sendBridgeMessage(socket, { type: "pong", at: new Date().toISOString() });
          } catch (error) {
            store.sendBridgeMessage(socket, {
              type: "bridge.error",
              deviceId: message.deviceId,
              code: "invalid_device_registration",
              error: error instanceof Error ? error.message : "Device registration failed.",
            });
            socket.close();
          }
          return;
        }

        if (message.type === "client.hello") {
          role = "client";
          clientToken = message.token;
          const tokenRecord = await store.getConnectToken(message.token);
          if (!tokenRecord) {
            store.sendBridgeMessage(socket, {
              type: "bridge.error",
              code: "invalid_connect_token",
              error: "Connect token is invalid.",
            });
            socket.close();
            return;
          }

          const device = await store.getDeviceSummary(tokenRecord.deviceId);
          if (!device) {
            store.sendBridgeMessage(socket, {
              type: "bridge.error",
              code: "device_not_found",
              error: "Device is not registered.",
            });
            socket.close();
            return;
          }

          if (!device.connected) {
            store.sendBridgeMessage(socket, {
              type: "bridge.error",
              code: "device_offline",
              error: "Device is offline.",
            });
            socket.close();
            return;
          }

          clientUser = {
            id: tokenRecord.userId,
            email: tokenRecord.userEmail,
          };
          if (await rejectInactiveSubscription()) {
            return;
          }

          await store.markConnectTokenUsed(message.token);
          await store.attachClient({
            socket,
            token: tokenRecord,
            clientPublicKey: message.clientPublicKey,
          });

          const session = await store.getSessionByUserId(tokenRecord.userId);
          const blockedReason = store.createProtocolMismatchReason(device, message.protocolVersion);
          store.sendBridgeMessage(socket, {
            type: "client.ready",
            session: store.serializeRelaySession(session),
            device: {
              ...device,
              blockedReason,
            },
            blockedReason,
          });
          return;
        }

        if (message.type === "bridge.envelope") {
          if (role === "client") {
            if (await rejectInactiveSubscription()) {
              return;
            }
            await store.touchClient(message.envelope.sessionId);
            await store.publishToDeviceChannel(message.envelope.deviceId, message);
            return;
          }

          if (role === "device") {
            await store.touchDevice(message.envelope.deviceId);
            await store.publishToClientChannel(message.envelope.sessionId, message);
          }
          return;
        }

        if (message.type === "rpc.response" && role === "device" && deviceId) {
          await store.touchDevice(deviceId);
          await store.publishRpcResponse(message);
          return;
        }

        if (message.type === "ping") {
          if (role === "device" && deviceId) {
            await store.touchDevice(deviceId);
          }
          if (role === "client" && clientToken) {
            if (await rejectInactiveSubscription()) {
              return;
            }
            await store.touchClient(clientToken);
          }
          store.sendBridgeMessage(socket, { type: "pong", at: new Date().toISOString() });
        }
      })().catch((error) => {
        console.error("Relay websocket handler failed:", error);
        socket.close();
      });
    });

    socket.on("close", () => {
      if (role === "client" && clientToken) {
        void store.deleteClient(clientToken);
      }
    });
  });

  return wsServer;
}

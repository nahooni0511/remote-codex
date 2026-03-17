import type { Server as HttpServer } from "node:http";

import { WebSocketServer } from "ws";
import type { BridgeMessage } from "@remote-codex/contracts";

import type { RelayStore } from "./store";

export function attachRelayWebSocketServer(server: HttpServer, store: RelayStore) {
  const wsServer = new WebSocketServer({ server, path: "/ws/bridge" });

  wsServer.on("connection", (socket) => {
    let role: "device" | "client" | null = null;
    let deviceId: string | null = null;
    let clientToken: string | null = null;

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

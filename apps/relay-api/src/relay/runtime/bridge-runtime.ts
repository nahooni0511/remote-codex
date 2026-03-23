import { randomUUID } from "node:crypto";

import type { AppUpdateApplyResult, AppUpdateStatus, BridgeMessage, RelayDeviceSummary } from "@remote-codex/contracts";
import type Redis from "ioredis";
import { WebSocket } from "ws";

import {
  CLIENT_CHANNEL,
  DEVICE_CHANNEL,
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_TTL_SECONDS,
  RPC_RESPONSE_CHANNEL,
} from "../config";
import { hashSecret, toSummary } from "../helpers";
import { parsePresencePayload, scanPresenceValues } from "../presence";
import type {
  ClientPubsubMessage,
  ConnectTokenRecord,
  DevicePubsubMessage,
  LocalClientConnection,
  LocalDeviceConnection,
  PendingRpc,
  RelayDeviceRow,
  RpcPubsubMessage,
} from "../types";

type BridgeRuntimeDependencies = {
  getDeviceRow: (deviceId: string) => Promise<RelayDeviceRow | null>;
  redis: Redis;
  subscriber: Redis;
  updateRegisteredDevice: (input: {
    appVersion: string;
    deviceId: string;
    devicePublicKey: string;
    displayName: string;
    lastSeenAt: string;
    minSupportedProtocol: string;
    ownerEmail: string | null;
    protocolVersion: string;
  }) => Promise<void>;
};

export async function createRelayBridgeRuntime(dependencies: BridgeRuntimeDependencies) {
  const { getDeviceRow, redis, subscriber, updateRegisteredDevice } = dependencies;
  const localDevices = new Map<string, LocalDeviceConnection>();
  const localClients = new Map<string, LocalClientConnection>();
  const pendingRpc = new Map<string, PendingRpc>();

  function sendBridgeMessage(socket: WebSocket, message: BridgeMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  async function refreshDevicePresence(summary: RelayDeviceSummary): Promise<void> {
    await redis.set(
      `rc:presence:device:${summary.deviceId}`,
      JSON.stringify({
        deviceId: summary.deviceId,
        displayName: summary.displayName,
        lastSeenAt: new Date().toISOString(),
      }),
      "EX",
      PRESENCE_TTL_SECONDS,
    );
  }

  async function deleteDevicePresence(deviceId: string): Promise<void> {
    await redis.del(`rc:presence:device:${deviceId}`);
  }

  async function refreshClientPresence(token: ConnectTokenRecord, clientPublicKey: string): Promise<void> {
    await redis.set(
      `rc:presence:client:${token.token}`,
      JSON.stringify({
        token: token.token,
        deviceId: token.deviceId,
        userId: token.userId,
        clientPublicKey,
      }),
      "EX",
      PRESENCE_TTL_SECONDS,
    );
  }

  async function deleteClientPresence(token: string): Promise<void> {
    await redis.del(`rc:presence:client:${token}`);
  }

  async function listActiveClientsForDevice(deviceId: string): Promise<Array<{ token: string; clientPublicKey: string }>> {
    const rows = await scanPresenceValues(redis, "rc:presence:client:*");
    return rows
      .map((row) => parsePresencePayload<{ token: string; deviceId: string; clientPublicKey: string }>(row))
      .filter((entry): entry is { token: string; deviceId: string; clientPublicKey: string } => Boolean(entry))
      .filter((entry) => entry.deviceId === deviceId)
      .map((entry) => ({
        token: entry.token,
        clientPublicKey: entry.clientPublicKey,
      }));
  }

  async function publishToDeviceChannel(deviceId: string, message: BridgeMessage): Promise<void> {
    const payload: DevicePubsubMessage = {
      targetDeviceId: deviceId,
      message,
    };
    await redis.publish(DEVICE_CHANNEL, JSON.stringify(payload));
  }

  async function publishToClientChannel(sessionId: string, message: BridgeMessage): Promise<void> {
    const payload: ClientPubsubMessage = {
      targetSessionId: sessionId,
      message,
    };
    await redis.publish(CLIENT_CHANNEL, JSON.stringify(payload));
  }

  async function publishRpcResponse(message: Extract<BridgeMessage, { type: "rpc.response" }>): Promise<void> {
    const payload: RpcPubsubMessage = {
      requestId: message.requestId,
      message,
    };
    await redis.publish(RPC_RESPONSE_CHANNEL, JSON.stringify(payload));
  }

  async function resolveRpcResponse(message: Extract<BridgeMessage, { type: "rpc.response" }>): Promise<void> {
    const pending = pendingRpc.get(message.requestId);
    if (!pending) {
      return;
    }

    pendingRpc.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.payload as AppUpdateStatus | AppUpdateApplyResult);
      return;
    }

    pending.reject(new Error(message.error || "RPC failed."));
  }

  async function handlePubsubMessage(channel: string, rawMessage: string): Promise<void> {
    if (channel === DEVICE_CHANNEL) {
      const { targetDeviceId, message } = JSON.parse(rawMessage) as DevicePubsubMessage;
      const device = localDevices.get(targetDeviceId);
      if (!device) {
        return;
      }

      sendBridgeMessage(device.socket, message);
      return;
    }

    if (channel === CLIENT_CHANNEL) {
      const { targetSessionId, message } = JSON.parse(rawMessage) as ClientPubsubMessage;
      const client = localClients.get(targetSessionId);
      if (!client) {
        return;
      }

      sendBridgeMessage(client.socket, message);
      return;
    }

    if (channel === RPC_RESPONSE_CHANNEL) {
      const { message } = JSON.parse(rawMessage) as RpcPubsubMessage;
      await resolveRpcResponse(message);
    }
  }

  await subscriber.subscribe(DEVICE_CHANNEL, CLIENT_CHANNEL, RPC_RESPONSE_CHANNEL);
  subscriber.on("message", (channel: string, rawMessage: string) => {
    void handlePubsubMessage(channel, rawMessage).catch((error) => {
      console.error("Relay pubsub dispatch failed:", error);
    });
  });

  async function registerDeviceConnection(input: {
    socket: WebSocket;
    message: Extract<BridgeMessage, { type: "device.hello" }>;
  }): Promise<RelayDeviceSummary> {
    const row = await getDeviceRow(input.message.deviceId);
    if (!row) {
      throw new Error("Device is not registered.");
    }

    if (row.device_secret_hash !== hashSecret(input.message.deviceSecret)) {
      throw new Error("Device secret is invalid.");
    }

    if (row.device_public_key && row.device_public_key !== input.message.devicePublicKey) {
      throw new Error("Device public key mismatch.");
    }

    const timestamp = new Date().toISOString();
    await updateRegisteredDevice({
      appVersion: input.message.appVersion || input.message.payload.appVersion,
      deviceId: input.message.deviceId,
      devicePublicKey: input.message.devicePublicKey,
      displayName: input.message.payload.displayName,
      lastSeenAt: timestamp,
      minSupportedProtocol: input.message.minSupportedProtocol,
      ownerEmail: input.message.ownerEmail || row.owner_email,
      protocolVersion: input.message.protocolVersion,
    });

    const summary = toSummary(
      {
        ...row,
        owner_email: input.message.ownerEmail || row.owner_email,
        display_name: input.message.payload.displayName,
        device_public_key: input.message.devicePublicKey,
        app_version: input.message.appVersion || input.message.payload.appVersion,
        protocol_version: input.message.protocolVersion,
        min_supported_protocol: input.message.minSupportedProtocol,
        last_seen_at: timestamp,
      },
      true,
    );

    const previous = localDevices.get(summary.deviceId);
    previous?.socket.close();

    const heartbeat = setInterval(() => {
      void refreshDevicePresence(summary).catch(() => undefined);
      sendBridgeMessage(input.socket, { type: "ping", at: new Date().toISOString() });
    }, HEARTBEAT_INTERVAL_MS);
    localDevices.set(summary.deviceId, {
      socket: input.socket,
      summary,
      heartbeat,
    });

    await refreshDevicePresence(summary);
    const activeClients = await listActiveClientsForDevice(summary.deviceId);
    for (const client of activeClients) {
      sendBridgeMessage(input.socket, {
        type: "client.attached",
        sessionId: client.token,
        clientPublicKey: client.clientPublicKey,
      });
    }

    input.socket.on("close", () => {
      const current = localDevices.get(summary.deviceId);
      if (current?.socket === input.socket) {
        localDevices.delete(summary.deviceId);
        void deleteDevicePresence(summary.deviceId).catch(() => undefined);
      }
      clearInterval(heartbeat);
    });

    input.socket.on("error", () => {
      input.socket.close();
    });

    return summary;
  }

  async function touchDevice(deviceId: string): Promise<void> {
    const device = localDevices.get(deviceId);
    if (!device) {
      return;
    }

    await refreshDevicePresence(device.summary);
  }

  async function attachClient(input: {
    socket: WebSocket;
    token: ConnectTokenRecord;
    clientPublicKey: string;
  }): Promise<void> {
    const previous = localClients.get(input.token.token);
    previous?.socket.close();

    const heartbeat = setInterval(() => {
      void refreshClientPresence(input.token, input.clientPublicKey).catch(() => undefined);
      sendBridgeMessage(input.socket, { type: "ping", at: new Date().toISOString() });
    }, HEARTBEAT_INTERVAL_MS);

    localClients.set(input.token.token, {
      socket: input.socket,
      token: input.token,
      clientPublicKey: input.clientPublicKey,
      heartbeat,
    });
    await refreshClientPresence(input.token, input.clientPublicKey);
    await publishToDeviceChannel(input.token.deviceId, {
      type: "client.attached",
      sessionId: input.token.token,
      clientPublicKey: input.clientPublicKey,
    });

    input.socket.on("close", () => {
      const current = localClients.get(input.token.token);
      if (current?.socket === input.socket) {
        void deleteClient(input.token.token);
      }
    });

    input.socket.on("error", () => {
      input.socket.close();
    });
  }

  async function touchClient(token: string): Promise<void> {
    const client = localClients.get(token);
    if (!client) {
      return;
    }

    await refreshClientPresence(client.token, client.clientPublicKey);
  }

  async function deleteClient(token: string): Promise<void> {
    const client = localClients.get(token);
    if (!client) {
      await deleteClientPresence(token);
      return;
    }

    localClients.delete(token);
    clearInterval(client.heartbeat);
    await deleteClientPresence(token);
    await publishToDeviceChannel(client.token.deviceId, {
      type: "client.detached",
      sessionId: token,
    });
  }

  async function sendUpdateRpc(
    deviceId: string,
    method: "system.update.check" | "system.update.apply",
  ): Promise<AppUpdateStatus | AppUpdateApplyResult> {
    const requestId = randomUUID();
    const promise = new Promise<AppUpdateStatus | AppUpdateApplyResult>((resolve, reject) => {
      pendingRpc.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (!pendingRpc.has(requestId)) {
          return;
        }

        pendingRpc.delete(requestId);
        reject(new Error("Device update request timed out."));
      }, 15_000);
    });

    await redis.set(`rc:rpc:${requestId}`, JSON.stringify({ deviceId, method }), "EX", 30);
    await publishToDeviceChannel(deviceId, {
      type: "rpc.request",
      requestId,
      method,
    });
    return promise;
  }

  async function close(): Promise<void> {
    localDevices.forEach((device) => clearInterval(device.heartbeat));
    localClients.forEach((client) => clearInterval(client.heartbeat));
    localDevices.clear();
    localClients.clear();
    await subscriber.quit();
    await redis.quit();
  }

  return {
    attachClient,
    close,
    deleteClient,
    publishRpcResponse,
    publishToClientChannel,
    publishToDeviceChannel,
    registerDeviceConnection,
    sendBridgeMessage,
    sendUpdateRpc,
    touchClient,
    touchDevice,
  };
}

import { randomUUID } from "node:crypto";

import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { Request, Response } from "express";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { WebSocket } from "ws";
import type {
  AppUpdateApplyResult,
  AppUpdateStatus,
  BridgeMessage,
  PairingCodeClaimRequest,
  PairingCodeClaimResponse,
  PairingCodeCreateResponse,
  ProtocolMismatchReason,
  RelayAuthSession,
  RelayDeviceSummary,
} from "@remote-codex/contracts";
import {
  CLIENT_CHANNEL,
  CONNECT_TOKEN_TTL_MS,
  DEVICE_CHANNEL,
  HEARTBEAT_INTERVAL_MS,
  PAIRING_CODE_TTL_MS,
  PRESENCE_TTL_SECONDS,
  RPC_RESPONSE_CHANNEL,
  loadRelayStoreConfig,
} from "./config";
import { buildWsUrl, getRequestBaseUrl, hashSecret, parseBearerToken, toRelaySession, toSqlDateTime, toSummary } from "./helpers";
import { parsePresencePayload, scanPresenceValues } from "./presence";
import { ensureRelaySchema } from "./schema";
import type {
  ClientPubsubMessage,
  ConnectTokenRecord,
  DevicePubsubMessage,
  LocalClientConnection,
  LocalDeviceConnection,
  PendingRpc,
  RelayConnectTokenRow,
  RelayDeviceRow,
  RelayPairingCodeRow,
  RelayUserRow,
  RpcPubsubMessage,
  SessionRecord,
} from "./types";

export async function createRelayStore(options: { port: number }) {
  const config = loadRelayStoreConfig(options.port);
  const pool = mysql.createPool({
    host: config.databaseHost,
    port: config.databasePort,
    user: config.databaseUser,
    password: config.databasePassword,
    database: config.databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
  });

  await ensureRelaySchema(pool);

  const redisOptions = config.valkeyUrl.startsWith("rediss://")
    ? { maxRetriesPerRequest: null, tls: {} }
    : { maxRetriesPerRequest: null };
  const redis = new Redis(config.valkeyUrl, redisOptions);
  const subscriber = new Redis(config.valkeyUrl, redisOptions);
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.cognitoUserPoolId,
    tokenUse: "id",
    clientId: config.cognitoWebClientId,
  });

  const localDevices = new Map<string, LocalDeviceConnection>();
  const localClients = new Map<string, LocalClientConnection>();
  const pendingRpc = new Map<string, PendingRpc>();

  async function upsertRelayUser(session: SessionRecord): Promise<void> {
    const timestamp = toSqlDateTime();
    await pool.execute(
      `
        INSERT INTO relay_users (cognito_sub, email, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          email = VALUES(email),
          updated_at = VALUES(updated_at)
      `,
      [session.user.id, session.user.email, timestamp, timestamp],
    );
  }

  async function findRelayUser(userId: string): Promise<RelayUserRow | null> {
    const [rows] = await pool.execute<RelayUserRow[]>(
      `SELECT cognito_sub, email FROM relay_users WHERE cognito_sub = ? LIMIT 1`,
      [userId],
    );
    return rows[0] || null;
  }

  async function verifySessionToken(token: string | null): Promise<SessionRecord | null> {
    if (!token) {
      return null;
    }

    if (
      config.testAuthToken &&
      token === config.testAuthToken &&
      config.testAuthEmail &&
      config.testAuthUserId
    ) {
      const session = toRelaySession(
        {
          cognito_sub: config.testAuthUserId,
          email: config.testAuthEmail,
        },
        null,
      );
      if (!session) {
        return null;
      }

      await upsertRelayUser(session);
      return session;
    }

    try {
      const claims = await verifier.verify(token);
      const email = typeof claims.email === "string" && claims.email.trim() ? claims.email.trim() : null;
      const userId = typeof claims.sub === "string" && claims.sub.trim() ? claims.sub.trim() : null;
      if (!email || !userId) {
        return null;
      }

      const expiresAt =
        typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null;
      const userRow = { cognito_sub: userId, email };
      const session = toRelaySession(userRow, expiresAt);
      if (!session) {
        return null;
      }

      await upsertRelayUser(session);
      return session;
    } catch {
      return null;
    }
  }

  async function getSessionFromRequest(request: Request): Promise<SessionRecord | null> {
    return verifySessionToken(parseBearerToken(request));
  }

  async function requireSession(request: Request, response: Response): Promise<SessionRecord | null> {
    const session = await getSessionFromRequest(request);
    if (!session) {
      response.status(401).json({ error: "Authentication required." });
      return null;
    }

    return session;
  }

  function serializeRelaySession(session: SessionRecord | null): RelayAuthSession {
    return {
      user: session?.user || null,
      expiresAt: session?.expiresAt || null,
    };
  }

  function createProtocolMismatchReason(
    device: RelayDeviceSummary,
    clientVersion: string,
  ): ProtocolMismatchReason | null {
    const [deviceMajor] = device.protocolVersion.split(".");
    const [clientMajor] = clientVersion.split(".");
    if (deviceMajor === clientMajor) {
      return null;
    }

    return {
      requiredVersion: device.minSupportedProtocol,
      actualVersion: clientVersion,
      message: `Client protocol ${clientVersion} is incompatible with device protocol ${device.protocolVersion}.`,
      updatePathAvailable: true,
    };
  }

  function sendBridgeMessage(socket: WebSocket, message: BridgeMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  async function writeAuditLog(
    action: string,
    input: {
      actorCognitoSub?: string | null;
      deviceId?: string | null;
      payloadJson?: string | null;
    } = {},
  ): Promise<void> {
    const timestamp = toSqlDateTime();
    await pool.execute(
      `
        INSERT INTO relay_audit_logs (actor_cognito_sub, device_id, action, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [input.actorCognitoSub || null, input.deviceId || null, action, input.payloadJson || null, timestamp],
    );
  }

  async function getDeviceRow(deviceId: string): Promise<RelayDeviceRow | null> {
    const [rows] = await pool.execute<RelayDeviceRow[]>(
      `
        SELECT
          device_id,
          owner_cognito_sub,
          owner_email,
          display_name,
          device_secret_hash,
          device_public_key,
          app_version,
          protocol_version,
          min_supported_protocol,
          last_seen_at,
          created_at,
          updated_at
        FROM relay_devices
        WHERE device_id = ?
        LIMIT 1
      `,
      [deviceId],
    );
    return rows[0] || null;
  }

  async function getDeviceSummary(deviceId: string): Promise<RelayDeviceSummary | null> {
    const row = await getDeviceRow(deviceId);
    if (!row) {
      return null;
    }

    const connected = Boolean(await redis.get(`rc:presence:device:${deviceId}`));
    return toSummary(row, connected);
  }

  async function listDevicesForSession(session: SessionRecord): Promise<RelayDeviceSummary[]> {
    const [rows] = await pool.execute<RelayDeviceRow[]>(
      `
        SELECT
          device_id,
          owner_cognito_sub,
          owner_email,
          display_name,
          device_secret_hash,
          device_public_key,
          app_version,
          protocol_version,
          min_supported_protocol,
          last_seen_at,
          created_at,
          updated_at
        FROM relay_devices
        WHERE owner_cognito_sub = ?
        ORDER BY display_name ASC
      `,
      [session.user.id],
    );

    const deviceRows = rows as RelayDeviceRow[];
    if (!deviceRows.length) {
      return [];
    }

    const presence = await Promise.all(
      deviceRows.map((row: RelayDeviceRow) => redis.get(`rc:presence:device:${row.device_id}`)),
    );
    return deviceRows.map((row: RelayDeviceRow, index: number) => toSummary(row, Boolean(presence[index])));
  }

  async function assertDeviceAccess(session: SessionRecord, deviceId: string): Promise<RelayDeviceSummary | null> {
    const row = await getDeviceRow(deviceId);
    if (!row || row.owner_cognito_sub !== session.user.id) {
      return null;
    }

    const connected = Boolean(await redis.get(`rc:presence:device:${deviceId}`));
    return toSummary(row, connected);
  }

  async function createConnectToken(session: SessionRecord, deviceId: string): Promise<ConnectTokenRecord> {
    const record: ConnectTokenRecord = {
      token: randomUUID(),
      userId: session.user.id,
      userEmail: session.user.email,
      deviceId,
      expiresAt: new Date(Date.now() + CONNECT_TOKEN_TTL_MS).toISOString(),
    };

    await pool.execute(
      `
        INSERT INTO relay_connect_tokens (token, owner_cognito_sub, owner_email, device_id, expires_at, used_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `,
      [
        record.token,
        record.userId,
        record.userEmail,
        record.deviceId,
        toSqlDateTime(record.expiresAt),
        toSqlDateTime(),
      ],
    );

    return record;
  }

  async function getConnectToken(token: string): Promise<ConnectTokenRecord | null> {
    const [rows] = await pool.execute<RelayConnectTokenRow[]>(
      `
        SELECT token, owner_cognito_sub, owner_email, device_id, expires_at, used_at, created_at
        FROM relay_connect_tokens
        WHERE token = ?
        LIMIT 1
      `,
      [token],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }

    const expiresAt = new Date(row.expires_at).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) {
      await deleteConnectToken(token);
      return null;
    }

    return {
      token: row.token,
      userId: row.owner_cognito_sub,
      userEmail: row.owner_email,
      deviceId: row.device_id,
      expiresAt,
    };
  }

  async function markConnectTokenUsed(token: string): Promise<void> {
    await pool.execute(
      `UPDATE relay_connect_tokens SET used_at = COALESCE(used_at, ?) WHERE token = ?`,
      [toSqlDateTime(), token],
    );
  }

  async function deleteConnectToken(token: string): Promise<void> {
    await pool.execute(`DELETE FROM relay_connect_tokens WHERE token = ?`, [token]);
  }

  async function createPairingCode(
    session: SessionRecord,
    ownerLabel: string,
  ): Promise<PairingCodeCreateResponse> {
    const record = {
      code: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      ownerLabel,
      expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString(),
    };

    await upsertRelayUser(session);
    await pool.execute(
      `
        INSERT INTO relay_pairing_codes
          (code, owner_cognito_sub, owner_email, owner_label, expires_at, claimed_at, claimed_device_id, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
      `,
      [
        record.code,
        session.user.id,
        session.user.email,
        record.ownerLabel,
        toSqlDateTime(record.expiresAt),
        toSqlDateTime(),
      ],
    );
    await writeAuditLog("pairing_code.created", {
      actorCognitoSub: session.user.id,
      payloadJson: JSON.stringify(record),
    });

    return record;
  }

  async function claimPairingCode(
    code: string,
    payload: PairingCodeClaimRequest,
    request: Request,
  ): Promise<PairingCodeClaimResponse> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RelayPairingCodeRow[]>(
        `
          SELECT code, owner_cognito_sub, owner_email, owner_label, expires_at, claimed_at, claimed_device_id, created_at
          FROM relay_pairing_codes
          WHERE code = ?
          LIMIT 1
          FOR UPDATE
        `,
        [code],
      );
      const pairingRow = rows[0];
      if (!pairingRow) {
        throw new Error("Pairing code not found.");
      }

      if (pairingRow.claimed_at) {
        throw new Error("Pairing code has already been claimed.");
      }

      if (Date.parse(new Date(pairingRow.expires_at).toISOString()) <= Date.now()) {
        throw new Error("Pairing code expired.");
      }

      const timestamp = toSqlDateTime();
      const deviceId = payload.device.localDeviceId;
      const deviceSecret = randomUUID().replace(/-/g, "");

      await connection.execute(
        `
          INSERT INTO relay_devices (
            device_id,
            owner_cognito_sub,
            owner_email,
            display_name,
            device_secret_hash,
            device_public_key,
            app_version,
            protocol_version,
            min_supported_protocol,
            last_seen_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          ON DUPLICATE KEY UPDATE
            owner_cognito_sub = VALUES(owner_cognito_sub),
            owner_email = VALUES(owner_email),
            display_name = VALUES(display_name),
            device_secret_hash = VALUES(device_secret_hash),
            device_public_key = VALUES(device_public_key),
            app_version = VALUES(app_version),
            protocol_version = VALUES(protocol_version),
            min_supported_protocol = VALUES(min_supported_protocol),
            updated_at = VALUES(updated_at)
        `,
        [
          deviceId,
          pairingRow.owner_cognito_sub,
          pairingRow.owner_email,
          payload.device.displayName,
          hashSecret(deviceSecret),
          payload.devicePublicKey,
          payload.device.appVersion,
          payload.protocolVersion,
          payload.minSupportedProtocol,
          timestamp,
          timestamp,
        ],
      );

      await connection.execute(
        `
          UPDATE relay_pairing_codes
          SET claimed_at = ?, claimed_device_id = ?
          WHERE code = ?
        `,
        [timestamp, deviceId, code],
      );

      await connection.commit();

      await writeAuditLog("pairing_code.claimed", {
        actorCognitoSub: pairingRow.owner_cognito_sub,
        deviceId,
        payloadJson: JSON.stringify({
          deviceId,
          displayName: payload.device.displayName,
          protocolVersion: payload.protocolVersion,
        }),
      });

      const baseUrl = getRequestBaseUrl(request, config.port);
      return {
        deviceId,
        deviceSecret,
        ownerLabel: pairingRow.owner_label,
        serverUrl: baseUrl,
        wsUrl: buildWsUrl(baseUrl),
        protocolVersion: payload.protocolVersion,
        minSupportedProtocol: payload.minSupportedProtocol,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
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
      const deviceId = targetDeviceId;
      const device = localDevices.get(deviceId);
      if (!device) {
        return;
      }

      sendBridgeMessage(device.socket, message);
      return;
    }

    if (channel === CLIENT_CHANNEL) {
      const { targetSessionId, message } = JSON.parse(rawMessage) as ClientPubsubMessage;
      const sessionId = targetSessionId;
      const client = localClients.get(sessionId);
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
    await pool.execute(
      `
        UPDATE relay_devices
        SET
          owner_email = ?,
          display_name = ?,
          device_public_key = ?,
          app_version = ?,
          protocol_version = ?,
          min_supported_protocol = ?,
          last_seen_at = ?,
          updated_at = ?
        WHERE device_id = ?
      `,
      [
        input.message.ownerEmail || row.owner_email,
        input.message.payload.displayName,
        input.message.devicePublicKey,
        input.message.appVersion || input.message.payload.appVersion,
        input.message.protocolVersion,
        input.message.minSupportedProtocol,
        timestamp,
        timestamp,
        input.message.deviceId,
      ],
    );

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

  async function getSessionByUserId(userId: string): Promise<SessionRecord | null> {
    const row = await findRelayUser(userId);
    if (!row) {
      return null;
    }

    return {
      user: {
        id: row.cognito_sub,
        email: row.email,
      },
      expiresAt: null,
    };
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
    await pool.end();
  }

  return {
    pool,
    redis,
    subscriber,
    getSessionFromRequest,
    requireSession,
    serializeRelaySession,
    createProtocolMismatchReason,
    sendBridgeMessage,
    listDevicesForSession,
    assertDeviceAccess,
    createConnectToken,
    getConnectToken,
    markConnectTokenUsed,
    deleteConnectToken,
    getSessionByUserId,
    getDeviceSummary,
    createPairingCode,
    claimPairingCode,
    registerDeviceConnection,
    attachClient,
    deleteClient,
    touchDevice,
    touchClient,
    publishToDeviceChannel,
    publishToClientChannel,
    publishRpcResponse,
    sendUpdateRpc,
    close,
  };
}

export type RelayStore = Awaited<ReturnType<typeof createRelayStore>>;

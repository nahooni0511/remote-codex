import { randomUUID } from "node:crypto";

import type {
  PairingCodeClaimRequest,
  PairingCodeClaimResponse,
  PairingCodeCreateResponse,
  ProtocolMismatchReason,
  RelayAuthExchangeResponse,
  RelayAuthSession,
  RelayClientAuthConfig,
  RelayDeviceSummary,
  RelayLocalSetupStatusResponse,
} from "@remote-codex/contracts";
import type { Request, Response } from "express";
import Redis from "ioredis";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { WebSocket } from "ws";
import type { JWTVerifyResult, JWTPayload } from "jose";
import type { AppUpdateApplyResult, AppUpdateStatus, BridgeMessage } from "@remote-codex/contracts";

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
import {
  buildWsUrl,
  createPasswordHash,
  fromSqlDateTime,
  generateOpaqueToken,
  getRequestBaseUrl,
  hashSecret,
  hashToken,
  parseBearerToken,
  toRelaySession,
  toSqlDateTime,
  toSummary,
  verifyPasswordHash,
} from "./helpers";
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
  RelayRefreshTokenRow,
  RelayStoreLocalAdminMethodConfig,
  RelayStoreOidcMethodConfig,
  RelayUserRow,
  RpcPubsubMessage,
  SessionRecord,
} from "./types";

const textEncoder = new TextEncoder();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRelayAccessTokenIssuer(serverName: string): string {
  return `relay:${serverName}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getProviderKey(prefix: "oidc" | "local-admin", methodId: string): string {
  return `${prefix}:${methodId}`;
}

function getCachedJwks(jwksUri: string) {
  const cached = jwksCache.get(jwksUri);
  if (cached) {
    return cached;
  }

  const next = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, next);
  return next;
}

export async function createRelayStore(options: { port: number }) {
  const config = await loadRelayStoreConfig(options.port);
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

  await ensureRelaySchema(pool, { defaultOidcIssuer: config.defaultOidcIssuer });

  const redisOptions = config.valkeyUrl.startsWith("rediss://")
    ? { maxRetriesPerRequest: null, tls: {} }
    : { maxRetriesPerRequest: null };
  const redis = new Redis(config.valkeyUrl, redisOptions);
  const subscriber = new Redis(config.valkeyUrl, redisOptions);
  const accessTokenSecret = textEncoder.encode(config.authSessionSecret);

  const localDevices = new Map<string, LocalDeviceConnection>();
  const localClients = new Map<string, LocalClientConnection>();
  const pendingRpc = new Map<string, PendingRpc>();

  async function findRelayUserById(userId: string): Promise<RelayUserRow | null> {
    const [rows] = await pool.execute<RelayUserRow[]>(
      `
        SELECT id, auth_provider, auth_subject, auth_issuer, email, password_hash, cognito_sub
        FROM relay_users
        WHERE id = ?
        LIMIT 1
      `,
      [userId],
    );
    return rows[0] || null;
  }

  async function findRelayUserByIdentity(authProvider: string, authSubject: string): Promise<RelayUserRow | null> {
    const [rows] = await pool.execute<RelayUserRow[]>(
      `
        SELECT id, auth_provider, auth_subject, auth_issuer, email, password_hash, cognito_sub
        FROM relay_users
        WHERE auth_provider = ? AND auth_subject = ?
        LIMIT 1
      `,
      [authProvider, authSubject],
    );
    return rows[0] || null;
  }

  async function findRelayUserByCognitoSub(cognitoSub: string): Promise<RelayUserRow | null> {
    const [rows] = await pool.execute<RelayUserRow[]>(
      `
        SELECT id, auth_provider, auth_subject, auth_issuer, email, password_hash, cognito_sub
        FROM relay_users
        WHERE cognito_sub = ?
        LIMIT 1
      `,
      [cognitoSub],
    );
    return rows[0] || null;
  }

  async function findLocalAdminByEmail(method: RelayStoreLocalAdminMethodConfig, email: string): Promise<RelayUserRow | null> {
    return findRelayUserByIdentity(getProviderKey("local-admin", method.id), normalizeEmail(email));
  }

  async function createRelayUser(input: {
    authProvider: string;
    authSubject: string;
    authIssuer?: string | null;
    email: string;
    passwordHash?: string | null;
    cognitoSub?: string | null;
  }): Promise<RelayUserRow> {
    const rowId = randomUUID().replace(/-/g, "");
    const timestamp = toSqlDateTime();
    await pool.execute(
      `
        INSERT INTO relay_users (
          id,
          auth_provider,
          auth_subject,
          auth_issuer,
          email,
          password_hash,
          cognito_sub,
          created_at,
          updated_at,
          last_login_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        rowId,
        input.authProvider,
        input.authSubject,
        input.authIssuer || null,
        normalizeEmail(input.email),
        input.passwordHash || null,
        input.cognitoSub || null,
        timestamp,
        timestamp,
        timestamp,
      ],
    );

    const created = await findRelayUserById(rowId);
    if (!created) {
      throw new Error("Failed to create relay user.");
    }

    return created;
  }

  async function updateRelayUser(rowId: string, input: {
    authProvider?: string;
    authSubject?: string;
    authIssuer?: string | null;
    email?: string;
    passwordHash?: string | null;
    cognitoSub?: string | null;
  }): Promise<RelayUserRow> {
    const existing = await findRelayUserById(rowId);
    if (!existing) {
      throw new Error("Relay user not found.");
    }

    const timestamp = toSqlDateTime();
    await pool.execute(
      `
        UPDATE relay_users
        SET
          auth_provider = ?,
          auth_subject = ?,
          auth_issuer = ?,
          email = ?,
          password_hash = ?,
          cognito_sub = ?,
          updated_at = ?,
          last_login_at = ?
        WHERE id = ?
      `,
      [
        input.authProvider || existing.auth_provider,
        input.authSubject || existing.auth_subject,
        input.authIssuer === undefined ? existing.auth_issuer : input.authIssuer,
        normalizeEmail(input.email || existing.email),
        input.passwordHash === undefined ? existing.password_hash : input.passwordHash,
        input.cognitoSub === undefined ? existing.cognito_sub || null : input.cognitoSub,
        timestamp,
        timestamp,
        rowId,
      ],
    );

    const updated = await findRelayUserById(rowId);
    if (!updated) {
      throw new Error("Relay user disappeared during update.");
    }

    return updated;
  }

  async function findRelayUserForOidc(method: RelayStoreOidcMethodConfig, claims: JWTVerifyResult<JWTPayload>["payload"]): Promise<RelayUserRow> {
    const email = typeof claims.email === "string" && claims.email.trim() ? normalizeEmail(claims.email) : null;
    const subject = typeof claims.sub === "string" && claims.sub.trim() ? claims.sub.trim() : null;
    if (!email || !subject) {
      throw new Error("OIDC provider did not return the required email/sub claims.");
    }

    const authProvider = getProviderKey("oidc", method.id);
    const identityMatch = await findRelayUserByIdentity(authProvider, subject);
    if (identityMatch) {
      return updateRelayUser(identityMatch.id, {
        authIssuer: method.issuer,
        email,
        cognitoSub: method.issuer === config.defaultOidcIssuer ? subject : identityMatch.cognito_sub || null,
      });
    }

    if (method.issuer === config.defaultOidcIssuer) {
      const legacyMatch = await findRelayUserByCognitoSub(subject);
      if (legacyMatch) {
        return updateRelayUser(legacyMatch.id, {
          authProvider,
          authSubject: subject,
          authIssuer: method.issuer,
          email,
          cognitoSub: subject,
        });
      }
    }

    return createRelayUser({
      authProvider,
      authSubject: subject,
      authIssuer: method.issuer,
      email,
      cognitoSub: method.issuer === config.defaultOidcIssuer ? subject : null,
    });
  }

  async function hasAnyLocalAdmin(): Promise<boolean> {
    const [rows] = await pool.query<Array<RowDataPacket & { count: number }>>(
      `
        SELECT COUNT(*) AS count
        FROM relay_users
        WHERE auth_provider LIKE 'local-admin:%'
      `,
    );
    return Number(rows[0]?.count || 0) > 0;
  }

  async function markUserLogin(rowId: string): Promise<void> {
    await pool.execute(`UPDATE relay_users SET last_login_at = ?, updated_at = ? WHERE id = ?`, [toSqlDateTime(), toSqlDateTime(), rowId]);
  }

  async function issueRelayTokens(user: RelayUserRow): Promise<RelayAuthExchangeResponse> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((issuedAt + config.authAccessTokenTtlSeconds) * 1000).toISOString();
    const refreshExpiresAt = new Date((issuedAt + config.authRefreshTokenTtlSeconds) * 1000).toISOString();

    const accessToken = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer(getRelayAccessTokenIssuer(config.serverName))
      .setAudience("relay-api")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + config.authAccessTokenTtlSeconds)
      .sign(accessTokenSecret);

    const refreshToken = generateOpaqueToken(48);
    await pool.execute(
      `
        INSERT INTO relay_refresh_tokens (token_hash, user_id, expires_at, revoked_at, replaced_by_token_hash, created_at)
        VALUES (?, ?, ?, NULL, NULL, ?)
      `,
      [hashToken(refreshToken), user.id, toSqlDateTime(refreshExpiresAt), toSqlDateTime()],
    );

    const session = toRelaySession(user, expiresAt);
    if (!session) {
      throw new Error("Unable to create relay session.");
    }

    await markUserLogin(user.id);

    return {
      session: serializeRelaySession(session),
      tokens: {
        accessToken,
        refreshToken,
        expiresAt,
        refreshExpiresAt,
      },
    };
  }

  async function revokeRefreshToken(tokenHash: string, replacedByTokenHash?: string | null): Promise<void> {
    await pool.execute(
      `
        UPDATE relay_refresh_tokens
        SET revoked_at = COALESCE(revoked_at, ?),
            replaced_by_token_hash = COALESCE(replaced_by_token_hash, ?)
        WHERE token_hash = ?
      `,
      [toSqlDateTime(), replacedByTokenHash || null, tokenHash],
    );
  }

  async function verifyAccessToken(token: string | null): Promise<SessionRecord | null> {
    if (!token) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(token, accessTokenSecret, {
        issuer: getRelayAccessTokenIssuer(config.serverName),
        audience: "relay-api",
      });
      const userId = typeof payload.sub === "string" && payload.sub.trim() ? payload.sub.trim() : null;
      if (!userId) {
        return null;
      }

      const user = await findRelayUserById(userId);
      if (!user) {
        return null;
      }

      const expiresAt = typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;
      return toRelaySession(user, expiresAt);
    } catch {
      return null;
    }
  }

  async function verifyOidcIdToken(method: RelayStoreOidcMethodConfig, idToken: string): Promise<JWTVerifyResult<JWTPayload>["payload"]> {
    const { payload } = await jwtVerify(idToken, getCachedJwks(method.jwksUri), {
      issuer: method.issuer,
      audience: method.clientId,
    });
    return payload;
  }

  async function getSessionFromRequest(request: Request): Promise<SessionRecord | null> {
    return verifyAccessToken(parseBearerToken(request));
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
      actorUserId?: string | null;
      actorCognitoSub?: string | null;
      deviceId?: string | null;
      payloadJson?: string | null;
    } = {},
  ): Promise<void> {
    const timestamp = toSqlDateTime();
    await pool.execute(
      `
        INSERT INTO relay_audit_logs (actor_user_id, actor_cognito_sub, device_id, action, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        input.actorUserId || null,
        input.actorCognitoSub || null,
        input.deviceId || null,
        action,
        input.payloadJson || null,
        timestamp,
      ],
    );
  }

  async function getDeviceRow(deviceId: string): Promise<RelayDeviceRow | null> {
    const [rows] = await pool.execute<RelayDeviceRow[]>(
      `
        SELECT
          device_id,
          owner_user_id,
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
          owner_user_id,
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
        WHERE owner_user_id = ?
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
    if (!row || row.owner_user_id !== session.user.id) {
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
        INSERT INTO relay_connect_tokens (token, owner_user_id, owner_email, device_id, expires_at, used_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `,
      [record.token, record.userId, record.userEmail, record.deviceId, toSqlDateTime(record.expiresAt), toSqlDateTime()],
    );

    return record;
  }

  async function getConnectToken(token: string): Promise<ConnectTokenRecord | null> {
    const [rows] = await pool.execute<RelayConnectTokenRow[]>(
      `
        SELECT token, owner_user_id, owner_cognito_sub, owner_email, device_id, expires_at, used_at, created_at
        FROM relay_connect_tokens
        WHERE token = ?
        LIMIT 1
      `,
      [token],
    );
    const row = rows[0];
    if (!row || !row.owner_user_id) {
      return null;
    }

    const expiresAt = fromSqlDateTime(row.expires_at).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) {
      await deleteConnectToken(token);
      return null;
    }

    return {
      token: row.token,
      userId: row.owner_user_id,
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

    await pool.execute(
      `
        INSERT INTO relay_pairing_codes
          (code, owner_user_id, owner_email, owner_label, expires_at, claimed_at, claimed_device_id, created_at)
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
      actorUserId: session.user.id,
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
          SELECT code, owner_user_id, owner_cognito_sub, owner_email, owner_label, expires_at, claimed_at, claimed_device_id, created_at
          FROM relay_pairing_codes
          WHERE code = ?
          LIMIT 1
          FOR UPDATE
        `,
        [code],
      );
      const pairingRow = rows[0];
      if (!pairingRow || !pairingRow.owner_user_id) {
        throw new Error("Pairing code not found.");
      }

      if (pairingRow.claimed_at) {
        throw new Error("Pairing code has already been claimed.");
      }

      if (Date.parse(fromSqlDateTime(pairingRow.expires_at).toISOString()) <= Date.now()) {
        throw new Error("Pairing code expired.");
      }

      const timestamp = toSqlDateTime();
      const deviceId = payload.device.localDeviceId;
      const deviceSecret = randomUUID().replace(/-/g, "");

      await connection.execute(
        `
          INSERT INTO relay_devices (
            device_id,
            owner_user_id,
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          ON DUPLICATE KEY UPDATE
            owner_user_id = VALUES(owner_user_id),
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
          pairingRow.owner_user_id,
          pairingRow.owner_cognito_sub || null,
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
        actorUserId: pairingRow.owner_user_id,
        actorCognitoSub: pairingRow.owner_cognito_sub || null,
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

  async function exchangeOidcIdToken(methodId: string, idToken: string): Promise<RelayAuthExchangeResponse> {
    const method = config.oidcMethods.find((entry) => entry.id === methodId);
    if (!method) {
      throw new Error("OIDC method is not configured.");
    }

    const claims = await verifyOidcIdToken(method, idToken);
    const user = await findRelayUserForOidc(method, claims);
    return issueRelayTokens(user);
  }

  async function getLocalAdminSetupStatus(methodId: string): Promise<RelayLocalSetupStatusResponse> {
    const method = config.localAdminMethods.find((entry) => entry.id === methodId);
    if (!method) {
      throw new Error("Local admin auth is not configured.");
    }

    return {
      methodId: method.id,
      setupRequired: !(await hasAnyLocalAdmin()),
      bootstrapEnabled: method.bootstrapEnabled,
    };
  }

  async function localAdminSetup(
    methodId: string,
    email: string,
    password: string,
    bootstrapToken: string,
  ): Promise<RelayAuthExchangeResponse> {
    const method = config.localAdminMethods.find((entry) => entry.id === methodId);
    if (!method) {
      throw new Error("Local admin auth is not configured.");
    }

    if (!(await getLocalAdminSetupStatus(methodId)).setupRequired) {
      throw new Error("Local admin setup is already complete.");
    }

    if (!method.bootstrapToken || bootstrapToken.trim() !== method.bootstrapToken) {
      throw new Error("Bootstrap token is invalid.");
    }

    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await createPasswordHash(password);
    const user = await createRelayUser({
      authProvider: getProviderKey("local-admin", method.id),
      authSubject: normalizedEmail,
      email: normalizedEmail,
      passwordHash,
    });

    return issueRelayTokens(user);
  }

  async function localAdminLogin(
    methodId: string,
    email: string,
    password: string,
  ): Promise<RelayAuthExchangeResponse> {
    const method = config.localAdminMethods.find((entry) => entry.id === methodId);
    if (!method) {
      throw new Error("Local admin auth is not configured.");
    }

    const user = await findLocalAdminByEmail(method, email);
    if (!user) {
      throw new Error("Email or password is invalid.");
    }

    const passwordValid = await verifyPasswordHash(password, user.password_hash);
    if (!passwordValid) {
      throw new Error("Email or password is invalid.");
    }

    return issueRelayTokens(user);
  }

  async function refreshAuthSession(refreshToken: string): Promise<RelayAuthExchangeResponse> {
    const tokenHash = hashToken(refreshToken);
    const [rows] = await pool.execute<RelayRefreshTokenRow[]>(
      `
        SELECT token_hash, user_id, expires_at, revoked_at, created_at, replaced_by_token_hash
        FROM relay_refresh_tokens
        WHERE token_hash = ?
        LIMIT 1
      `,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("Refresh token is invalid.");
    }

    if (row.revoked_at) {
      throw new Error("Refresh token has been revoked.");
    }

    const expiresAt = fromSqlDateTime(row.expires_at).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) {
      await revokeRefreshToken(tokenHash);
      throw new Error("Refresh token expired.");
    }

    const user = await findRelayUserById(row.user_id);
    if (!user) {
      await revokeRefreshToken(tokenHash);
      throw new Error("Refresh token is invalid.");
    }

    const next = await issueRelayTokens(user);
    await revokeRefreshToken(tokenHash, hashToken(next.tokens.refreshToken));
    return next;
  }

  async function logoutSession(refreshToken: string | null): Promise<void> {
    if (!refreshToken) {
      return;
    }

    await revokeRefreshToken(hashToken(refreshToken));
  }

  async function getClientAuthConfig(baseUrl: string): Promise<RelayClientAuthConfig> {
    const localAdminSetupRequired = !(await hasAnyLocalAdmin());

    return {
      serverName: config.serverName,
      serverUrl: baseUrl,
      methods: [
        ...config.oidcMethods.map(({ jwksUri: _jwksUri, ...method }) => method),
        ...config.localAdminMethods.map((method) => ({
          id: method.id,
          type: method.type,
          label: method.label,
          setupRequired: localAdminSetupRequired,
          bootstrapEnabled: method.bootstrapEnabled,
        })),
      ],
    };
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
    const dbTimestamp = toSqlDateTime(timestamp);
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
        dbTimestamp,
        dbTimestamp,
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
    const row = await findRelayUserById(userId);
    if (!row) {
      return null;
    }

    return toRelaySession(row, null);
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
    config,
    pool,
    redis,
    subscriber,
    getClientAuthConfig,
    exchangeOidcIdToken,
    getLocalAdminSetupStatus,
    localAdminSetup,
    localAdminLogin,
    refreshAuthSession,
    logoutSession,
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

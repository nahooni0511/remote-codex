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
import type { JWTVerifyResult, JWTPayload } from "jose";
import type { BridgeMessage } from "@remote-codex/contracts";

import {
  CONNECT_TOKEN_TTL_MS,
  PAIRING_CODE_TTL_MS,
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
  toSummary,
  verifyPasswordHash,
} from "./helpers";
import { ensureRelaySchema } from "./schema";
import { writeAuditLog as writeAuditLogRow } from "./db/audit";
import {
  getDeviceRow as getDeviceRowRecord,
  listDeviceRowsByOwner,
  updateRegisteredDevice,
} from "./db/devices";
import { claimPairingCodeWithDevice, createPairingCodeRow } from "./db/pairing";
import {
  createConnectTokenRow,
  deleteConnectToken as deleteConnectTokenRow,
  getConnectTokenRow,
  getRefreshTokenByHash,
  insertRefreshToken,
  markConnectTokenUsed as markConnectTokenUsedRow,
  revokeRefreshToken as revokeRefreshTokenRow,
} from "./db/tokens";
import {
  createRelayUser as createRelayUserRow,
  findLocalAdminByEmail as findLocalAdminByEmailRow,
  findRelayUserByCognitoSub as findRelayUserByCognitoSubRow,
  findRelayUserById as findRelayUserByIdRow,
  findRelayUserByIdentity as findRelayUserByIdentityRow,
  hasAnyLocalAdmin as hasAnyLocalAdminRow,
  markUserLogin as markUserLoginRow,
  updateRelayUser as updateRelayUserRow,
} from "./db/users";
import { createRelayBridgeRuntime } from "./runtime/bridge-runtime";
import type { ConnectTokenRecord, RelayDeviceRow, RelayStoreLocalAdminMethodConfig, RelayStoreOidcMethodConfig, RelayUserRow, SessionRecord } from "./types";

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

  async function findRelayUserById(userId: string): Promise<RelayUserRow | null> {
    return findRelayUserByIdRow(pool, userId);
  }

  async function findRelayUserByIdentity(authProvider: string, authSubject: string): Promise<RelayUserRow | null> {
    return findRelayUserByIdentityRow(pool, authProvider, authSubject);
  }

  async function findRelayUserByCognitoSub(cognitoSub: string): Promise<RelayUserRow | null> {
    return findRelayUserByCognitoSubRow(pool, cognitoSub);
  }

  async function findLocalAdminByEmail(method: RelayStoreLocalAdminMethodConfig, email: string): Promise<RelayUserRow | null> {
    return findLocalAdminByEmailRow(pool, getProviderKey("local-admin", method.id), email);
  }

  async function createRelayUser(input: {
    authProvider: string;
    authSubject: string;
    authIssuer?: string | null;
    email: string;
    passwordHash?: string | null;
    cognitoSub?: string | null;
  }): Promise<RelayUserRow> {
    return createRelayUserRow(pool, input);
  }

  async function updateRelayUser(rowId: string, input: {
    authProvider?: string;
    authSubject?: string;
    authIssuer?: string | null;
    email?: string;
    passwordHash?: string | null;
    cognitoSub?: string | null;
  }): Promise<RelayUserRow> {
    return updateRelayUserRow(pool, rowId, input);
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
    return hasAnyLocalAdminRow(pool);
  }

  async function markUserLogin(rowId: string): Promise<void> {
    await markUserLoginRow(pool, rowId);
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
    await insertRefreshToken(pool, {
      expiresAt: refreshExpiresAt,
      tokenHash: hashToken(refreshToken),
      userId: user.id,
    });

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
    await revokeRefreshTokenRow(pool, tokenHash, replacedByTokenHash);
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

  async function writeAuditLog(
    action: string,
    input: {
      actorUserId?: string | null;
      actorCognitoSub?: string | null;
      deviceId?: string | null;
      payloadJson?: string | null;
    } = {},
  ): Promise<void> {
    await writeAuditLogRow(pool, action, input);
  }

  async function getDeviceRow(deviceId: string): Promise<RelayDeviceRow | null> {
    return getDeviceRowRecord(pool, deviceId);
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
    const deviceRows = await listDeviceRowsByOwner(pool, session.user.id);
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

    await createConnectTokenRow(pool, record);

    return record;
  }

  async function getConnectToken(token: string): Promise<ConnectTokenRecord | null> {
    const row = await getConnectTokenRow(pool, token);
    if (!row) {
      return null;
    }

    const expiresAt = row.expiresAt;
    if (Date.parse(expiresAt) <= Date.now()) {
      await deleteConnectToken(token);
      return null;
    }

    return row;
  }

  async function markConnectTokenUsed(token: string): Promise<void> {
    await markConnectTokenUsedRow(pool, token);
  }

  async function deleteConnectToken(token: string): Promise<void> {
    await deleteConnectTokenRow(pool, token);
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

    await createPairingCodeRow(pool, {
      code: record.code,
      ownerUserId: session.user.id,
      ownerEmail: session.user.email,
      ownerLabel: record.ownerLabel,
      expiresAt: record.expiresAt,
    });
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
    const claimed = await claimPairingCodeWithDevice(pool, code, payload);

    await writeAuditLog("pairing_code.claimed", {
      actorUserId: claimed.ownerUserId,
      actorCognitoSub: claimed.ownerCognitoSub,
      deviceId: claimed.deviceId,
      payloadJson: JSON.stringify({
        deviceId: claimed.deviceId,
        displayName: payload.device.displayName,
        protocolVersion: payload.protocolVersion,
      }),
    });

    const baseUrl = getRequestBaseUrl(request, config.port);
    return {
      deviceId: claimed.deviceId,
      deviceSecret: claimed.deviceSecret,
      ownerLabel: claimed.ownerLabel,
      serverUrl: baseUrl,
      wsUrl: buildWsUrl(baseUrl),
      protocolVersion: payload.protocolVersion,
      minSupportedProtocol: payload.minSupportedProtocol,
    };
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
    const row = await getRefreshTokenByHash(pool, tokenHash);
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
  async function getSessionByUserId(userId: string): Promise<SessionRecord | null> {
    const row = await findRelayUserById(userId);
    if (!row) {
      return null;
    }

    return toRelaySession(row, null);
  }

  const bridgeRuntime = await createRelayBridgeRuntime({
    getDeviceRow,
    redis,
    subscriber,
    updateRegisteredDevice: (input) => updateRegisteredDevice(pool, input),
  });

  async function close(): Promise<void> {
    await bridgeRuntime.close();
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
    registerDeviceConnection: bridgeRuntime.registerDeviceConnection,
    attachClient: bridgeRuntime.attachClient,
    deleteClient: bridgeRuntime.deleteClient,
    touchDevice: bridgeRuntime.touchDevice,
    touchClient: bridgeRuntime.touchClient,
    publishToDeviceChannel: bridgeRuntime.publishToDeviceChannel,
    publishToClientChannel: bridgeRuntime.publishToClientChannel,
    publishRpcResponse: bridgeRuntime.publishRpcResponse,
    sendBridgeMessage: bridgeRuntime.sendBridgeMessage,
    sendUpdateRpc: bridgeRuntime.sendUpdateRpc,
    close,
  };
}

export type RelayStore = Awaited<ReturnType<typeof createRelayStore>>;

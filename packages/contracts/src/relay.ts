import type { DeviceProfile, IntegrationSummary, PairingCodeRecord } from "./integrations";
import type { RuntimeSummary, ProjectTreeRecord } from "./workspace";
import type { RealtimeEvent } from "./realtime";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

export function normalizeRelayServerUrl(value: string): string {
  const input = value.trim();
  if (!input) {
    throw new Error("Relay Server URL을 입력하세요.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Relay Server URL 형식이 올바르지 않습니다.");
  }

  if (url.username || url.password) {
    throw new Error("Relay Server URL에는 사용자 정보나 비밀번호를 포함할 수 없습니다.");
  }

  const loopback = isLoopbackHost(url.hostname);
  const localHttp = url.protocol === "http:" && loopback;
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Relay Server URL은 HTTPS만 허용됩니다. 로컬 테스트에는 localhost HTTP만 사용할 수 있습니다.");
  }

  return url.origin;
}

export interface DeviceWorkspaceSnapshot {
  device: DeviceProfile;
  workspace: {
    projects: ProjectTreeRecord[];
  };
  runtime: RuntimeSummary;
  integrations: IntegrationSummary;
  updatedAt: string;
}

export interface GlobalDeviceListItem {
  deviceId: string;
  displayName: string;
  ownerLabel: string;
  connected: boolean;
  lastSeenAt: string | null;
  snapshotUpdatedAt: string | null;
}

export interface ProtocolMismatchReason {
  requiredVersion: string;
  actualVersion: string;
  message: string;
  updatePathAvailable: boolean;
}

export interface RelayAuthUser {
  id: string;
  email: string;
}

export interface RelayAuthSession {
  user: RelayAuthUser | null;
  expiresAt: string | null;
}

export interface RelayOidcAuthMethod {
  id: string;
  type: "oidc";
  label: string;
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string | null;
  endSessionEndpoint?: string | null;
  scopes: string[];
  pkce: true;
}

export interface RelayLocalAdminAuthMethod {
  id: string;
  type: "local-admin";
  label: string;
  setupRequired: boolean;
  bootstrapEnabled: boolean;
}

export type RelayAuthMethod = RelayOidcAuthMethod | RelayLocalAdminAuthMethod;

export interface RelayClientAuthConfig {
  serverName: string;
  serverUrl: string;
  methods: RelayAuthMethod[];
}

export interface RelayAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

export interface RelayAuthExchangeResponse {
  session: RelayAuthSession;
  tokens: RelayAuthTokens;
}

export interface RelayOidcExchangeRequest {
  methodId: string;
  idToken: string;
}

export interface RelayLocalLoginRequest {
  methodId: string;
  email: string;
  password: string;
}

export interface RelayLocalSetupStatusResponse {
  methodId: string;
  setupRequired: boolean;
  bootstrapEnabled: boolean;
}

export interface RelayLocalSetupRequest {
  methodId: string;
  email: string;
  password: string;
  bootstrapToken: string;
}

export interface RelayRefreshRequest {
  refreshToken: string;
}

export interface RelayLogoutRequest {
  refreshToken?: string | null;
}

export interface RelayDeviceSummary {
  deviceId: string;
  displayName: string;
  ownerEmail: string | null;
  appVersion: string;
  protocolVersion: string;
  minSupportedProtocol: string;
  devicePublicKey: string | null;
  connected: boolean;
  lastSeenAt: string | null;
  snapshotUpdatedAt: string | null;
  blockedReason: ProtocolMismatchReason | null;
}

export interface DeviceConnectTokenResponse {
  token: string;
  wsUrl: string;
  expiresAt: string;
  device: RelayDeviceSummary;
}

export interface PairingCodeCreateResponse extends PairingCodeRecord {}

export interface RelayBillingStatusResponse {
  enabled: boolean;
  active: boolean;
  appUserId: string | null;
  entitlementLookupKey: string | null;
  offeringLookupKey: string | null;
  publicApiKey: string | null;
}

export interface PairingCodeClaimRequest {
  device: DeviceProfile;
  devicePublicKey: string;
  protocolVersion: string;
  minSupportedProtocol: string;
}

export interface PairingCodeClaimResponse {
  deviceId: string;
  deviceSecret: string;
  ownerLabel: string;
  serverUrl: string;
  wsUrl: string;
  protocolVersion: string;
  minSupportedProtocol: string;
}

export interface EncryptedBridgePayload {
  algorithm: "nacl-box";
  senderPublicKey: string;
  recipientPublicKey: string | null;
  nonce: string;
  ciphertext: string;
}

export interface BridgeEnvelope {
  sessionId: string;
  deviceId: string;
  payload: EncryptedBridgePayload;
}

export interface BridgeHttpRequestPayload {
  kind: "http.request";
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  bodyEncoding: "utf8" | "base64";
}

export interface BridgeHttpResponsePayload {
  kind: "http.response";
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string | null;
  bodyEncoding: "utf8" | "base64";
}

export interface BridgeRealtimePayload {
  kind: "realtime.event";
  event: RealtimeEvent;
}

export interface BridgeProtocolBlockedPayload {
  kind: "protocol.blocked";
  reason: ProtocolMismatchReason;
}

export type EncryptedBridgeData =
  | BridgeHttpRequestPayload
  | BridgeHttpResponsePayload
  | BridgeRealtimePayload
  | BridgeProtocolBlockedPayload;

export type BridgeRpcMethod =
  | "system.update.check"
  | "system.update.apply"
  | "workspace.get"
  | "projects.create"
  | "projects.update"
  | "projects.delete"
  | "threads.create"
  | "threads.update"
  | "threads.delete"
  | "messages.list"
  | "messages.send"
  | "cron.list"
  | "cron.create"
  | "cron.update"
  | "cron.delete"
  | "settings.get"
  | "settings.update"
  | "settings.reset"
  | "fs.listDirectories"
  | "integrations.global.unpair"
  | "integrations.telegram.connect"
  | "integrations.telegram.disconnect"
  | "integrations.telegram.sync";

export type BridgeMessage =
  | {
      type: "device.hello";
      deviceId: string;
      deviceSecret: string;
      protocolVersion: string;
      minSupportedProtocol: string;
      devicePublicKey: string;
      ownerEmail?: string | null;
      appVersion?: string | null;
      payload: DeviceProfile;
    }
  | {
      type: "client.hello";
      token: string;
      protocolVersion: string;
      clientPublicKey: string;
    }
  | {
      type: "client.ready";
      session: RelayAuthSession;
      device: RelayDeviceSummary;
      blockedReason: ProtocolMismatchReason | null;
    }
  | {
      type: "client.attached";
      sessionId: string;
      clientPublicKey: string;
    }
  | {
      type: "client.detached";
      sessionId: string;
    }
  | {
      type: "workspace.snapshot";
      payload: DeviceWorkspaceSnapshot;
    }
  | {
      type: "device.event";
      payload: RealtimeEvent;
    }
  | {
      type: "rpc.request";
      requestId: string;
      method: BridgeRpcMethod;
      payload?: unknown;
    }
  | {
      type: "rpc.response";
      requestId: string;
      ok: boolean;
      payload?: unknown;
      error?: string;
    }
  | {
      type: "bridge.envelope";
      envelope: BridgeEnvelope;
    }
  | {
      type: "bridge.error";
      deviceId?: string | null;
      sessionId?: string | null;
      code: string;
      error: string;
      blockedReason?: ProtocolMismatchReason | null;
    }
  | {
      type: "ping" | "pong";
      at: string;
    };

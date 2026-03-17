import type { DeviceProfile, IntegrationSummary, PairingCodeRecord } from "./integrations";
import type { RuntimeSummary, ProjectTreeRecord } from "./workspace";
import type { RealtimeEvent } from "./realtime";

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

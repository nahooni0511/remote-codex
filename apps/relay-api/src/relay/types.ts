import type {
  AppUpdateApplyResult,
  AppUpdateStatus,
  BridgeMessage,
  RelayAuthUser,
  RelayDeviceSummary,
  RelayLocalAdminAuthMethod,
  RelayOidcAuthMethod,
} from "@remote-codex/contracts";
import type { RowDataPacket } from "mysql2/promise";
import type { WebSocket } from "ws";

export type PendingRpc = {
  resolve: (value: AppUpdateStatus | AppUpdateApplyResult) => void;
  reject: (error: Error) => void;
};

export type DevicePubsubMessage = {
  targetDeviceId: string;
  message: BridgeMessage;
};

export type ClientPubsubMessage = {
  targetSessionId: string;
  message: BridgeMessage;
};

export type RpcPubsubMessage = {
  requestId: string;
  message: Extract<BridgeMessage, { type: "rpc.response" }>;
};

export type SessionRecord = {
  user: RelayAuthUser;
  expiresAt: string | null;
};

export type ConnectTokenRecord = {
  token: string;
  userId: string;
  userEmail: string;
  deviceId: string;
  expiresAt: string;
};

export type LocalDeviceConnection = {
  socket: WebSocket;
  summary: RelayDeviceSummary;
  heartbeat: NodeJS.Timeout;
};

export type LocalClientConnection = {
  socket: WebSocket;
  token: ConnectTokenRecord;
  clientPublicKey: string;
  heartbeat: NodeJS.Timeout;
};

export type RelayUserRow = RowDataPacket & {
  id: string;
  auth_provider: string;
  auth_subject: string;
  auth_issuer: string | null;
  email: string;
  password_hash: string | null;
  cognito_sub?: string | null;
};

export type RelayDeviceRow = RowDataPacket & {
  device_id: string;
  owner_user_id: string | null;
  owner_cognito_sub?: string | null;
  owner_email: string | null;
  display_name: string;
  device_secret_hash: string;
  device_public_key: string | null;
  app_version: string;
  protocol_version: string;
  min_supported_protocol: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RelayPairingCodeRow = RowDataPacket & {
  code: string;
  owner_user_id: string | null;
  owner_cognito_sub?: string | null;
  owner_email: string;
  owner_label: string;
  expires_at: string;
  claimed_at: string | null;
  claimed_device_id: string | null;
  created_at: string;
};

export type RelayConnectTokenRow = RowDataPacket & {
  token: string;
  owner_user_id: string | null;
  owner_cognito_sub?: string | null;
  owner_email: string;
  device_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type RelayRefreshTokenRow = RowDataPacket & {
  token_hash: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  replaced_by_token_hash: string | null;
};

export type RelayStoreOidcMethodConfig = RelayOidcAuthMethod & {
  jwksUri: string;
};

export type RelayStoreLocalAdminMethodConfig = RelayLocalAdminAuthMethod & {
  bootstrapToken: string | null;
};

export type RelayStoreConfig = {
  port: number;
  serverName: string;
  databaseHost: string;
  databasePort: number;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  valkeyUrl: string;
  authSessionSecret: string;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlSeconds: number;
  oidcMethods: RelayStoreOidcMethodConfig[];
  localAdminMethods: RelayStoreLocalAdminMethodConfig[];
  defaultOidcIssuer: string | null;
};

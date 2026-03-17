export interface TelegramAuthSummary {
  isAuthenticated: boolean;
  phoneNumber: string | null;
  userName: string | null;
}

export interface DeviceProfile {
  localDeviceId: string;
  displayName: string;
  hostName: string;
  os: string;
  platform: string;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilitySummary {
  codexReady: boolean;
  telegramAvailable: boolean;
  globalRelayAvailable: boolean;
  autoStartSupported: boolean;
}

export interface TelegramIntegrationSummary {
  enabled: boolean;
  connected: boolean;
  phoneNumber: string | null;
  userName: string | null;
  botUserName: string | null;
}

export interface GlobalIntegrationSummary {
  enabled: boolean;
  paired: boolean;
  connected: boolean;
  deviceId: string | null;
  ownerLabel: string | null;
  serverUrl: string | null;
  lastSyncAt: string | null;
}

export interface IntegrationSummary {
  telegram: TelegramIntegrationSummary;
  global: GlobalIntegrationSummary;
}

export interface TelegramProjectBindingRecord {
  id: number;
  projectId: number;
  telegramChatId: string | null;
  telegramAccessHash: string | null;
  telegramChatTitle: string | null;
  forumEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramThreadBindingRecord {
  id: number;
  threadId: number;
  telegramTopicId: number;
  telegramTopicName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionRecord = TelegramProjectBindingRecord;

export interface PairingCodeRecord {
  code: string;
  ownerLabel: string;
  expiresAt: string;
}

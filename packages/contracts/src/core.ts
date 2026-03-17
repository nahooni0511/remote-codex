export interface ApiErrorResponse {
  error: string;
  code?: string;
}

export type ChannelKind = "local-ui" | "global-ui" | "telegram";

export type ThreadMode = "default" | "plan" | null;

export type CodexPermissionMode = "default" | "danger-full-access";

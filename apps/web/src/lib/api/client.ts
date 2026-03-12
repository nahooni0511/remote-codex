import type { ApiErrorResponse } from "@remote-codex/contracts";

export class ApiError extends Error {
  public readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

function getApiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function buildWsUrl(): string {
  const configured = (import.meta.env.VITE_WS_URL || "").trim();
  if (configured) {
    return configured;
  }

  const base = getApiBaseUrl();
  if (base) {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildAttachmentUrl(messageId: number): string {
  return buildApiUrl(`/api/messages/${messageId}/attachment`);
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as T | ApiErrorResponse)
    : (({ error: await response.text() } satisfies ApiErrorResponse) as T | ApiErrorResponse);

  if (!response.ok) {
    const errorPayload = payload as ApiErrorResponse;
    throw new ApiError(errorPayload.error || "요청에 실패했습니다.", errorPayload.code);
  }

  return payload as T;
}

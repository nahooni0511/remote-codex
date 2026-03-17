import { RelayBridgeClient } from "@remote-codex/client-core";
import type { ApiErrorResponse, BridgeHttpResponsePayload, RealtimeEvent } from "@remote-codex/contracts";

export class ApiError extends Error {
  public readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

type WorkspaceTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  bodyEncoding: "utf8" | "base64";
};

type RealtimeSubscription = {
  close: () => void;
};

export interface WorkspaceTransport {
  kind: "direct" | "relay";
  request: (path: string, options?: RequestInit) => Promise<WorkspaceTransportResponse>;
  connectRealtime: (
    onEvent: (event: RealtimeEvent) => void,
    onDisconnect?: () => void,
  ) => Promise<RealtimeSubscription>;
}

let activeTransport: WorkspaceTransport | null = null;

function normalizeHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(Array.from(headers.entries()));
}

function isTextualContentType(contentType: string): boolean {
  return (
    contentType.includes("application/json") ||
    contentType.startsWith("text/") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/xml")
  );
}

function getApiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
}

function buildDirectApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

function buildDirectWsUrl(): string {
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

function getTransport(): WorkspaceTransport {
  if (activeTransport) {
    return activeTransport;
  }

  activeTransport = createDirectWorkspaceTransport();
  return activeTransport;
}

export function configureWorkspaceTransport(transport: WorkspaceTransport): void {
  activeTransport = transport;
}

export function resetWorkspaceTransport(): void {
  activeTransport = null;
}

export function createDirectWorkspaceTransport(): WorkspaceTransport {
  return {
    kind: "direct",
    async request(path, options = {}) {
      const response = await fetch(buildDirectApiUrl(path), {
        headers: {
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers || {}),
        },
        ...options,
      });
      const headers = normalizeHeaders(response.headers);
      const contentType = headers["content-type"] || "";
      if (response.status === 204) {
        return { status: response.status, headers, body: null, bodyEncoding: "utf8" };
      }

      if (isTextualContentType(contentType)) {
        return {
          status: response.status,
          headers,
          body: await response.text(),
          bodyEncoding: "utf8",
        };
      }

      const buffer = await response.arrayBuffer();
      return {
        status: response.status,
        headers,
        body: btoa(String.fromCharCode(...new Uint8Array(buffer))),
        bodyEncoding: "base64",
      };
    },
    async connectRealtime(onEvent, onDisconnect) {
      const socket = new WebSocket(buildDirectWsUrl());
      socket.addEventListener("message", (messageEvent) => {
        try {
          onEvent(JSON.parse(String(messageEvent.data)) as RealtimeEvent);
        } catch (error) {
          console.error("Realtime message parse failed:", error);
        }
      });
      socket.addEventListener("close", () => {
        onDisconnect?.();
      });
      socket.addEventListener("error", () => {
        onDisconnect?.();
      });
      return {
        close: () => socket.close(),
      };
    },
  };
}

export function createRelayWorkspaceTransport(client: RelayBridgeClient): WorkspaceTransport {
  return {
    kind: "relay",
    async request(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (options.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      const body =
        typeof options.body === "string"
          ? options.body
          : options.body
            ? JSON.stringify(options.body)
            : null;

      const response = await client.request({
        method: options.method || "GET",
        path,
        headers: Object.fromEntries(headers.entries()),
        body,
        bodyEncoding: "utf8",
      });

      return response;
    },
    async connectRealtime(onEvent, onDisconnect) {
      await client.connect();
      const unsubscribe = client.onRealtime(onEvent);
      const unsubscribeBlocked = client.onBlocked(() => {
        onDisconnect?.();
      });
      const unsubscribeClose = client.onClose(() => {
        onDisconnect?.();
      });
      return {
        close: () => {
          unsubscribe();
          unsubscribeBlocked();
          unsubscribeClose();
        },
      };
    },
  };
}

async function readPayload<T>(response: WorkspaceTransportResponse): Promise<T> {
  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers["content-type"] || "";
  const payload =
    response.bodyEncoding === "base64"
      ? (({ error: response.body || "Binary response is not supported for JSON fetch." } satisfies ApiErrorResponse) as
          | ApiErrorResponse
          | T)
      : contentType.includes("application/json")
        ? ((JSON.parse(response.body || "null") as T | ApiErrorResponse))
        : (({ error: response.body || "" } satisfies ApiErrorResponse) as T | ApiErrorResponse);

  if (response.status >= 400) {
    const errorPayload = payload as ApiErrorResponse;
    throw new ApiError(errorPayload.error || "요청에 실패했습니다.", errorPayload.code);
  }

  return payload as T;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return readPayload<T>(await getTransport().request(path, options));
}

export async function fetchAttachmentBlob(messageId: number): Promise<{
  blob: Blob;
  fileName: string | null;
  contentType: string;
}> {
  const response = await getTransport().request(`/api/messages/${messageId}/attachment`, { method: "GET" });
  if (response.status >= 400) {
    await readPayload(response);
  }

  const contentType = response.headers["content-type"] || "application/octet-stream";
  const match = (response.headers["content-disposition"] || "").match(/filename\*=UTF-8''([^;]+)/);
  const fileName = match ? decodeURIComponent(match[1]) : null;

  if (response.bodyEncoding === "base64") {
    const binary = atob(response.body || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return {
      blob: new Blob([bytes], { type: contentType }),
      fileName,
      contentType,
    };
  }

  return {
    blob: new Blob([response.body || ""], { type: contentType }),
    fileName,
    contentType,
  };
}

export async function connectRealtime(
  onEvent: (event: RealtimeEvent) => void,
  onDisconnect?: () => void,
): Promise<RealtimeSubscription> {
  return getTransport().connectRealtime(onEvent, onDisconnect);
}

export type { BridgeHttpResponsePayload };

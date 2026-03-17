import type {
  BridgeEnvelope,
  BridgeHttpRequestPayload,
  BridgeHttpResponsePayload,
  BridgeMessage,
  DeviceConnectTokenResponse,
  EncryptedBridgeData,
  ProtocolMismatchReason,
  RealtimeEvent,
  RelayAuthSession,
  RelayDeviceSummary,
} from "@remote-codex/contracts";

import { createSessionKeyPair, decryptBridgeData, encryptBridgeData } from "./crypto";
import { CURRENT_PROTOCOL_VERSION } from "./protocol";

type PendingRequest = {
  resolve: (value: BridgeHttpResponsePayload) => void;
  reject: (error: Error) => void;
};

export interface RelayBridgeClientState {
  session: RelayAuthSession;
  device: RelayDeviceSummary;
  blockedReason: ProtocolMismatchReason | null;
}

type RelayBridgeClientOptions = {
  connectToken: DeviceConnectTokenResponse;
  protocolVersion?: string;
  webSocketFactory?: (url: string) => WebSocket;
};

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class RelayBridgeClient {
  private readonly connectToken: DeviceConnectTokenResponse;
  private readonly keyPair = createSessionKeyPair();
  private readonly protocolVersion: string;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private websocket: WebSocket | null = null;
  private readyPromise: Promise<RelayBridgeClientState> | null = null;
  private readyResolve: ((value: RelayBridgeClientState) => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly realtimeListeners = new Set<(event: RealtimeEvent) => void>();
  private readonly blockedListeners = new Set<(reason: ProtocolMismatchReason) => void>();
  private readonly closeListeners = new Set<() => void>();
  private state: RelayBridgeClientState | null = null;

  constructor(options: RelayBridgeClientOptions) {
    this.connectToken = options.connectToken;
    this.protocolVersion = options.protocolVersion || CURRENT_PROTOCOL_VERSION;
    this.webSocketFactory = options.webSocketFactory || ((url) => new WebSocket(url));
  }

  async connect(): Promise<RelayBridgeClientState> {
    if (this.state) {
      return this.state;
    }

    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise<RelayBridgeClientState>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const socket = this.webSocketFactory(this.connectToken.wsUrl);
    this.websocket = socket;

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "client.hello",
          token: this.connectToken.token,
          protocolVersion: this.protocolVersion,
          clientPublicKey: this.keyPair.publicKey,
        } satisfies BridgeMessage),
      );
    });

    socket.addEventListener("message", (event) => {
      this.handleIncomingMessage(String(event.data));
    });

    socket.addEventListener("error", () => {
      this.rejectReady(new Error("Relay websocket failed."));
    });

    socket.addEventListener("close", () => {
      const error = new Error("Relay websocket closed.");
      this.rejectReady(error);
      this.pendingRequests.forEach((pending) => pending.reject(error));
      this.pendingRequests.clear();
      this.websocket = null;
      this.state = null;
      this.readyPromise = null;
      this.closeListeners.forEach((listener) => listener());
    });

    return this.readyPromise;
  }

  onRealtime(listener: (event: RealtimeEvent) => void): () => void {
    this.realtimeListeners.add(listener);
    return () => {
      this.realtimeListeners.delete(listener);
    };
  }

  onBlocked(listener: (reason: ProtocolMismatchReason) => void): () => void {
    this.blockedListeners.add(listener);
    return () => {
      this.blockedListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async request(input: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string | null;
    bodyEncoding?: "utf8" | "base64";
  }): Promise<BridgeHttpResponsePayload> {
    const state = await this.connect();
    if (state.blockedReason) {
      throw new Error(state.blockedReason.message);
    }

    if (!state.device.devicePublicKey) {
      throw new Error("Device public key is not available.");
    }

    const requestId = makeRequestId();
    const payload: BridgeHttpRequestPayload = {
      kind: "http.request",
      requestId,
      method: input.method,
      path: input.path,
      headers: input.headers || {},
      body: input.body ?? null,
      bodyEncoding: input.bodyEncoding || "utf8",
    };

    return new Promise<BridgeHttpResponsePayload>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      this.sendEncryptedPayload({
        data: payload,
        recipientPublicKey: state.device.devicePublicKey!,
      });
    });
  }

  close(): void {
    this.websocket?.close();
  }

  private sendEncryptedPayload(input: {
    data: EncryptedBridgeData;
    recipientPublicKey: string;
  }): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay websocket is not connected.");
    }

    const envelope: BridgeEnvelope = {
      sessionId: this.connectToken.token,
      deviceId: this.connectToken.device.deviceId,
      payload: encryptBridgeData({
        data: input.data,
        senderPublicKey: this.keyPair.publicKey,
        senderSecretKey: this.keyPair.secretKey,
        recipientPublicKey: input.recipientPublicKey,
      }),
    };

    this.websocket.send(
      JSON.stringify({
        type: "bridge.envelope",
        envelope,
      } satisfies BridgeMessage),
    );
  }

  private handleIncomingMessage(rawMessage: string): void {
    const message = JSON.parse(rawMessage) as BridgeMessage;

    if (message.type === "client.ready") {
      this.state = {
        session: message.session,
        device: message.device,
        blockedReason: message.blockedReason,
      };
      this.readyResolve?.(this.state);
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    if (message.type === "bridge.error") {
      if (message.blockedReason) {
        this.blockedListeners.forEach((listener) => listener(message.blockedReason!));
      }

      const error = new Error(message.error);
      if (message.sessionId && this.pendingRequests.has(message.sessionId)) {
        this.pendingRequests.get(message.sessionId)?.reject(error);
        this.pendingRequests.delete(message.sessionId);
      }
      return;
    }

    if (message.type !== "bridge.envelope") {
      return;
    }

    const decrypted = decryptBridgeData({
      payload: message.envelope.payload,
      recipientSecretKey: this.keyPair.secretKey,
    });

    if (decrypted.kind === "http.response") {
      const pending = this.pendingRequests.get(decrypted.requestId);
      if (!pending) {
        return;
      }

      pending.resolve(decrypted);
      this.pendingRequests.delete(decrypted.requestId);
      return;
    }

    if (decrypted.kind === "realtime.event") {
      this.realtimeListeners.forEach((listener) => listener(decrypted.event));
      return;
    }

    if (decrypted.kind === "protocol.blocked") {
      this.blockedListeners.forEach((listener) => listener(decrypted.reason));
    }
  }

  private rejectReady(error: Error): void {
    this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
  }
}

import type {
  RelayAuthExchangeResponse,
  RelayClientAuthConfig,
  RelayLocalSetupStatusResponse,
  RelayLogoutRequest,
  RelayOidcExchangeRequest,
  RelayRefreshRequest,
} from "@remote-codex/contracts";
import type { Request } from "express";

import { getRequestBaseUrl } from "../helpers";
import type { RelayStore } from "../store";

export function createRelayAuthService(options: { port: number; store: RelayStore }) {
  const { port, store } = options;

  return {
    async getSession(request: Request) {
      return store.serializeRelaySession(await store.getSessionFromRequest(request));
    },
    async getAuthConfig(request: Request): Promise<RelayClientAuthConfig> {
      return store.getClientAuthConfig(getRequestBaseUrl(request, port));
    },
    async exchangeOidc(body: RelayOidcExchangeRequest): Promise<RelayAuthExchangeResponse> {
      return store.exchangeOidcIdToken(body.methodId, body.idToken);
    },
    async getLocalSetupStatus(methodId: string): Promise<RelayLocalSetupStatusResponse> {
      return store.getLocalAdminSetupStatus(methodId);
    },
    async setupLocalAdmin(input: {
      bootstrapToken: string;
      email: string;
      methodId: string;
      password: string;
    }): Promise<RelayAuthExchangeResponse> {
      return store.localAdminSetup(input.methodId, input.email, input.password, input.bootstrapToken);
    },
    async loginLocalAdmin(input: { email: string; methodId: string; password: string }): Promise<RelayAuthExchangeResponse> {
      return store.localAdminLogin(input.methodId, input.email, input.password);
    },
    async refreshSession(body: RelayRefreshRequest): Promise<RelayAuthExchangeResponse> {
      return store.refreshAuthSession(body.refreshToken);
    },
    async logout(body: RelayLogoutRequest | undefined): Promise<void> {
      await store.logoutSession(body?.refreshToken || null);
    },
  };
}

export type RelayAuthService = ReturnType<typeof createRelayAuthService>;

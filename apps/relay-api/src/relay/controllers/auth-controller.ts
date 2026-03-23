import type {
  RelayLocalLoginRequest,
  RelayLocalSetupRequest,
  RelayLogoutRequest,
  RelayOidcExchangeRequest,
  RelayRefreshRequest,
} from "@remote-codex/contracts";
import type { RequestHandler, Response } from "express";

import type { RelayAuthService } from "../services/auth-service";

function badRequest(response: Response, message: string) {
  response.status(400).json({ error: message });
}

export function createRelayAuthController(service: RelayAuthService): {
  getSession: RequestHandler;
  getConfig: RequestHandler;
  exchangeOidc: RequestHandler;
  getLocalSetupStatus: RequestHandler;
  setupLocalAdmin: RequestHandler;
  loginLocalAdmin: RequestHandler;
  refreshSession: RequestHandler;
  logout: RequestHandler;
} {
  return {
    async getSession(request, response) {
      response.json(await service.getSession(request));
    },
    async getConfig(request, response) {
      response.json(await service.getAuthConfig(request));
    },
    async exchangeOidc(request, response) {
      const body = request.body as RelayOidcExchangeRequest | undefined;
      if (!body?.methodId || !body.idToken) {
        badRequest(response, "methodId and idToken are required.");
        return;
      }

      try {
        response.status(201).json(await service.exchangeOidc(body));
      } catch (error) {
        response.status(401).json({ error: error instanceof Error ? error.message : "OIDC exchange failed." });
      }
    },
    async getLocalSetupStatus(request, response) {
      const methodId = typeof request.query.methodId === "string" ? request.query.methodId.trim() : "";
      if (!methodId) {
        badRequest(response, "methodId is required.");
        return;
      }

      try {
        response.json(await service.getLocalSetupStatus(methodId));
      } catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : "Local admin auth is unavailable." });
      }
    },
    async setupLocalAdmin(request, response) {
      const body = request.body as RelayLocalSetupRequest | undefined;
      if (!body?.methodId || !body.email || !body.password || !body.bootstrapToken) {
        badRequest(response, "methodId, email, password, and bootstrapToken are required.");
        return;
      }

      try {
        response.status(201).json(
          await service.setupLocalAdmin({
            bootstrapToken: body.bootstrapToken,
            email: body.email,
            methodId: body.methodId,
            password: body.password,
          }),
        );
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : "Local admin setup failed." });
      }
    },
    async loginLocalAdmin(request, response) {
      const body = request.body as RelayLocalLoginRequest | undefined;
      if (!body?.methodId || !body.email || !body.password) {
        badRequest(response, "methodId, email, and password are required.");
        return;
      }

      try {
        response.status(201).json(
          await service.loginLocalAdmin({
            email: body.email,
            methodId: body.methodId,
            password: body.password,
          }),
        );
      } catch (error) {
        response.status(401).json({ error: error instanceof Error ? error.message : "Local admin sign-in failed." });
      }
    },
    async refreshSession(request, response) {
      const body = request.body as RelayRefreshRequest | undefined;
      if (!body?.refreshToken) {
        badRequest(response, "refreshToken is required.");
        return;
      }

      try {
        response.status(201).json(await service.refreshSession(body));
      } catch (error) {
        response.status(401).json({ error: error instanceof Error ? error.message : "Refresh failed." });
      }
    },
    async logout(request, response) {
      const body = request.body as RelayLogoutRequest | undefined;
      await service.logout(body);
      response.status(204).end();
    },
  };
}

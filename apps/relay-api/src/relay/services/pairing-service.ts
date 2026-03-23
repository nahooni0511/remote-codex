import type {
  PairingCodeClaimRequest,
  PairingCodeClaimResponse,
  PairingCodeCreateResponse,
} from "@remote-codex/contracts";
import type { Request, Response } from "express";

import type { RelayStore } from "../store";

export function createRelayPairingService(options: { store: RelayStore }) {
  const { store } = options;

  return {
    async createPairingCode(request: Request, response: Response, ownerLabel: string | null): Promise<PairingCodeCreateResponse | null> {
      const session = await store.requireSession(request, response);
      if (!session) {
        return null;
      }

      return store.createPairingCode(session, ownerLabel || session.user.email);
    },
    async claimPairingCode(
      code: string,
      payload: PairingCodeClaimRequest,
      request: Request,
    ): Promise<PairingCodeClaimResponse> {
      return store.claimPairingCode(code, payload, request);
    },
  };
}

export type RelayPairingService = ReturnType<typeof createRelayPairingService>;

import type { PairingCodeClaimRequest } from "@remote-codex/contracts";
import type { RequestHandler, Response } from "express";

import type { RelayPairingService } from "../services/pairing-service";

function badRequest(response: Response, message: string) {
  response.status(400).json({ error: message });
}

export function createRelayPairingController(service: RelayPairingService): {
  createPairingCode: RequestHandler;
  claimPairingCode: RequestHandler;
} {
  return {
    async createPairingCode(request, response) {
      const ownerLabel =
        (typeof request.body?.ownerLabel === "string" && request.body.ownerLabel.trim()) || null;
      const payload = await service.createPairingCode(request, response, ownerLabel || "");
      if (!payload) {
        return;
      }

      response.status(201).json(payload);
    },
    async claimPairingCode(request, response) {
      const code = typeof request.params.code === "string" ? request.params.code.trim().toUpperCase() : "";
      if (!code) {
        badRequest(response, "Pairing code is required.");
        return;
      }

      const body = request.body as PairingCodeClaimRequest | undefined;
      if (!body?.device?.localDeviceId || !body.devicePublicKey || !body.protocolVersion || !body.minSupportedProtocol) {
        badRequest(response, "Incomplete pairing claim payload.");
        return;
      }

      try {
        response.status(201).json(await service.claimPairingCode(code, body, request));
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Pairing claim failed.",
        });
      }
    },
  };
}

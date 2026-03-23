import type { Request, Response } from "express";

import {
  claimGlobalIntegration,
  clearGlobalIntegration,
  clearTelegramIntegration,
  getIntegrationsSummary,
  saveGlobalIntegration,
} from "../services/integrations-service";

export function getIntegrations(_request: Request, response: Response) {
  response.json(getIntegrationsSummary());
}

export function createGlobalIntegration(request: Request, response: Response) {
  const pairing = saveGlobalIntegration({
    enabled: request.body?.enabled,
    deviceId: typeof request.body?.deviceId === "string" ? request.body.deviceId : null,
    deviceSecret: typeof request.body?.deviceSecret === "string" ? request.body.deviceSecret : null,
    ownerLabel: typeof request.body?.ownerLabel === "string" ? request.body.ownerLabel : null,
    serverUrl: typeof request.body?.serverUrl === "string" ? request.body.serverUrl : null,
    wsUrl: typeof request.body?.wsUrl === "string" ? request.body.wsUrl : null,
    connected: request.body?.connected,
    lastSyncAt: typeof request.body?.lastSyncAt === "string" ? request.body.lastSyncAt : null,
  });

  response.status(201).json({ global: pairing });
}

export async function claimGlobalPairing(request: Request, response: Response) {
  const pairing = await claimGlobalIntegration({
    pairingCode: typeof request.body?.pairingCode === "string" ? request.body.pairingCode : "",
    serverUrl: typeof request.body?.serverUrl === "string" ? request.body.serverUrl : "",
  });

  response.status(201).json({ global: pairing });
}

export function deleteGlobalIntegration(_request: Request, response: Response) {
  clearGlobalIntegration();
  response.status(204).end();
}

export async function deleteTelegramIntegration(_request: Request, response: Response) {
  await clearTelegramIntegration();
  response.status(204).end();
}

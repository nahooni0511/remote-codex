import type { DeviceConnectTokenResponse } from "@remote-codex/contracts";
import type { Request, Response } from "express";

import { buildWsUrl, getRequestBaseUrl } from "../helpers";
import type { RelayStore } from "../store";
import {
  SUBSCRIPTION_REQUIRED_CODE,
  type RevenueCatService,
} from "./revenuecat-service";

export function createRelayDeviceService(options: {
  port: number;
  revenueCat: RevenueCatService;
  store: RelayStore;
}) {
  const { port, revenueCat, store } = options;

  return {
    async requireSession(request: Request, response: Response) {
      return store.requireSession(request, response);
    },
    async listDevices(request: Request, response: Response) {
      const session = await store.requireSession(request, response);
      if (!session) {
        return null;
      }

      return {
        devices: await store.listDevicesForSession(session),
      };
    },
    async createConnectToken(request: Request, response: Response, deviceId: string): Promise<DeviceConnectTokenResponse | null> {
      const session = await store.requireSession(request, response);
      if (!session) {
        return null;
      }

      const billing = await revenueCat.getBillingStatus(session.user);
      if (billing.enabled && !billing.active) {
        response.status(402).json({
          error: "Active subscription required to access remote workspaces.",
          code: SUBSCRIPTION_REQUIRED_CODE,
        });
        return null;
      }

      const device = await store.assertDeviceAccess(session, deviceId);
      if (!device) {
        return null;
      }

      const tokenRecord = await store.createConnectToken(session, device.deviceId);
      return {
        token: tokenRecord.token,
        wsUrl: buildWsUrl(getRequestBaseUrl(request, port)),
        expiresAt: tokenRecord.expiresAt,
        device,
      };
    },
    async checkDeviceAccess(request: Request, response: Response, deviceId: string) {
      const session = await store.requireSession(request, response);
      if (!session) {
        return null;
      }

      return store.assertDeviceAccess(session, deviceId);
    },
    async sendUpdateCheck(deviceId: string) {
      return store.sendUpdateRpc(deviceId, "system.update.check");
    },
    async sendUpdateApply(deviceId: string) {
      return store.sendUpdateRpc(deviceId, "system.update.apply");
    },
  };
}

export type RelayDeviceService = ReturnType<typeof createRelayDeviceService>;

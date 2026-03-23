import type { RequestHandler } from "express";

import type { RelayDeviceService } from "../services/device-service";

export function createRelayDeviceController(service: RelayDeviceService): {
  listDevices: RequestHandler;
  createConnectToken: RequestHandler;
  checkDeviceUpdate: RequestHandler;
  applyDeviceUpdate: RequestHandler;
} {
  const getDeviceId = (value: string | string[]) => (Array.isArray(value) ? value[0] || "" : value);

  return {
    async listDevices(request, response) {
      const payload = await service.listDevices(request, response);
      if (!payload) {
        return;
      }

      response.json(payload);
    },
    async createConnectToken(request, response) {
      const payload = await service.createConnectToken(request, response, getDeviceId(request.params.deviceId));
      if (!payload) {
        if (!response.headersSent) {
          response.status(404).json({ error: "Device not found." });
        }
        return;
      }

      response.json(payload);
    },
    async checkDeviceUpdate(request, response) {
      const device = await service.checkDeviceAccess(request, response, getDeviceId(request.params.deviceId));
      if (!device) {
        if (!response.headersSent) {
          response.status(404).json({ error: "Device not found." });
        }
        return;
      }

      response.json(await service.sendUpdateCheck(device.deviceId));
    },
    async applyDeviceUpdate(request, response) {
      const device = await service.checkDeviceAccess(request, response, getDeviceId(request.params.deviceId));
      if (!device) {
        if (!response.headersSent) {
          response.status(404).json({ error: "Device not found." });
        }
        return;
      }

      response.json(await service.sendUpdateApply(device.deviceId));
    },
  };
}

import type { RequestHandler } from "express";

import type { RelayBillingService } from "../services/billing-service";

export function createRelayBillingController(service: RelayBillingService): {
  getBillingStatus: RequestHandler;
} {
  return {
    async getBillingStatus(request, response) {
      const payload = await service.getBillingStatus(request, response);
      if (!payload) {
        return;
      }

      response.json(payload);
    },
  };
}

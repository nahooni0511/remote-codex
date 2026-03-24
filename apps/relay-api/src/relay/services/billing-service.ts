import type { Request, Response } from "express";

import type { RelayStore } from "../store";
import type { RevenueCatService } from "./revenuecat-service";

export function createRelayBillingService(options: {
  revenueCat: RevenueCatService;
  store: RelayStore;
}) {
  const { revenueCat, store } = options;

  return {
    async getBillingStatus(request: Request, response: Response) {
      const session = await store.requireSession(request, response);
      if (!session) {
        return null;
      }

      return revenueCat.getBillingStatus(session.user);
    },
  };
}

export type RelayBillingService = ReturnType<typeof createRelayBillingService>;

import type { RelayBillingStatusResponse, RelayAuthUser } from "@remote-codex/contracts";

const REVENUECAT_API_BASE_URL = "https://api.revenuecat.com/v2";
const PREFERRED_APP_TYPES = ["rc_billing", "stripe", "test_store"] as const;

type RevenueCatListResponse<T> = {
  object: "list";
  items: T[];
  next_page?: string | null;
  url?: string;
};

type RevenueCatProjectRecord = {
  id: string;
  name: string;
};

type RevenueCatAppRecord = {
  id: string;
  name: string;
  type: string;
};

type RevenueCatPublicApiKeyRecord = {
  environment: string;
  key: string;
};

type RevenueCatActiveEntitlementRecord = {
  id: string;
  lookup_key: string;
};

type RevenueCatErrorPayload = {
  message?: string;
  type?: string;
};

export const SUBSCRIPTION_REQUIRED_CODE = "SUBSCRIPTION_REQUIRED";

class RevenueCatApiError extends Error {
  public readonly status: number;
  public readonly type: string | null;

  constructor(message: string, status: number, type: string | null = null) {
    super(message);
    this.name = "RevenueCatApiError";
    this.status = status;
    this.type = type;
  }
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function parseRevenueCatError(payload: unknown, status: number): RevenueCatApiError {
  if (payload && typeof payload === "object") {
    const typed = payload as RevenueCatErrorPayload;
    return new RevenueCatApiError(typed.message || "RevenueCat request failed.", status, typed.type || null);
  }

  return new RevenueCatApiError("RevenueCat request failed.", status, null);
}

function choosePreferredApp(apps: RevenueCatAppRecord[]): RevenueCatAppRecord | null {
  for (const type of PREFERRED_APP_TYPES) {
    const exactMatch = apps.find((entry) => entry.type === type);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const fuzzyMatch = apps.find((entry) => entry.type.includes("billing"));
  return fuzzyMatch || apps[0] || null;
}

export function createRevenueCatService() {
  const apiKey = getOptionalEnv("REVENUECAT_SECRET_API_KEY");
  const entitlementLookupKey = getOptionalEnv("REVENUECAT_ENTITLEMENT_LOOKUP_KEY") || "pro";
  const offeringLookupKey = getOptionalEnv("REVENUECAT_OFFERING_LOOKUP_KEY") || "default";
  const configuredProjectId = getOptionalEnv("REVENUECAT_PROJECT_ID");
  const configuredAppId = getOptionalEnv("REVENUECAT_APP_ID");

  let projectIdPromise: Promise<string | null> | null = null;
  let appPromise: Promise<RevenueCatAppRecord | null> | null = null;
  let publicApiKeyPromise: Promise<string | null> | null = null;

  async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!apiKey) {
      throw new Error("RevenueCat is not configured.");
    }

    const response = await fetch(`${REVENUECAT_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw parseRevenueCatError(payload, response.status);
    }

    return payload as T;
  }

  async function resolveProjectId(): Promise<string | null> {
    if (!apiKey) {
      return null;
    }

    if (configuredProjectId) {
      return configuredProjectId;
    }

    if (!projectIdPromise) {
      projectIdPromise = apiFetch<RevenueCatListResponse<RevenueCatProjectRecord>>("/projects")
        .then((payload) => {
          if (!payload.items.length) {
            return null;
          }

          if (payload.items.length > 1) {
            throw new Error("Multiple RevenueCat projects found. Set REVENUECAT_PROJECT_ID explicitly.");
          }

          return payload.items[0]!.id;
        })
        .catch((error) => {
          projectIdPromise = null;
          throw error;
        });
    }

    return projectIdPromise;
  }

  async function resolveBillingApp(): Promise<RevenueCatAppRecord | null> {
    if (!apiKey) {
      return null;
    }

    if (!appPromise) {
      appPromise = (async () => {
        const projectId = await resolveProjectId();
        if (!projectId) {
          return null;
        }

        const payload = await apiFetch<RevenueCatListResponse<RevenueCatAppRecord>>(`/projects/${projectId}/apps`);
        if (!payload.items.length) {
          return null;
        }

        if (configuredAppId) {
          return payload.items.find((entry) => entry.id === configuredAppId) || null;
        }

        return choosePreferredApp(payload.items);
      })().catch((error) => {
        appPromise = null;
        throw error;
      });
    }

    return appPromise;
  }

  async function resolvePublicApiKey(): Promise<string | null> {
    if (!apiKey) {
      return null;
    }

    if (!publicApiKeyPromise) {
      publicApiKeyPromise = (async () => {
        const projectId = await resolveProjectId();
        const app = await resolveBillingApp();
        if (!projectId || !app) {
          return null;
        }

        const payload = await apiFetch<RevenueCatListResponse<RevenueCatPublicApiKeyRecord>>(
          `/projects/${projectId}/apps/${app.id}/public_api_keys`,
        );
        const preferred = payload.items.find((entry) => entry.environment === "production");
        return preferred?.key || payload.items[0]?.key || null;
      })().catch((error) => {
        publicApiKeyPromise = null;
        throw error;
      });
    }

    return publicApiKeyPromise;
  }

  async function hasActiveEntitlement(appUserId: string): Promise<boolean> {
    if (!apiKey) {
      return false;
    }

    const projectId = await resolveProjectId();
    if (!projectId) {
      return false;
    }

    try {
      const payload = await apiFetch<RevenueCatListResponse<RevenueCatActiveEntitlementRecord>>(
        `/projects/${projectId}/customers/${encodeURIComponent(appUserId)}/active_entitlements`,
      );
      return payload.items.some((entry) => entry.lookup_key === entitlementLookupKey);
    } catch (error) {
      if (error instanceof RevenueCatApiError && error.status === 404) {
        return false;
      }

      throw error;
    }
  }

  async function getBillingStatus(user: RelayAuthUser): Promise<RelayBillingStatusResponse> {
    if (!apiKey) {
      return {
        enabled: false,
        active: false,
        appUserId: user.id,
        entitlementLookupKey: null,
        offeringLookupKey: null,
        publicApiKey: null,
      };
    }

    const [publicApiKey, active] = await Promise.all([resolvePublicApiKey(), hasActiveEntitlement(user.id)]);

    return {
      enabled: Boolean(publicApiKey && entitlementLookupKey && offeringLookupKey),
      active,
      appUserId: user.id,
      entitlementLookupKey,
      offeringLookupKey,
      publicApiKey,
    };
  }

  return {
    isConfigured() {
      return Boolean(apiKey);
    },
    getEntitlementLookupKey() {
      return apiKey ? entitlementLookupKey : null;
    },
    async getBillingStatus(user: RelayAuthUser) {
      return getBillingStatus(user);
    },
  };
}

export type RevenueCatService = ReturnType<typeof createRevenueCatService>;

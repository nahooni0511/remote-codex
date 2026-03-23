import type { RequestHandler } from "express";

export function createHealthController(): { getHealth: RequestHandler } {
  return {
    getHealth(_request, response) {
      response.json({
        ok: true,
        service: "relay-api",
        now: new Date().toISOString(),
      });
    },
  };
}

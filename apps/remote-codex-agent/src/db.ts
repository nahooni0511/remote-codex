import "./db/schema";

import { syncCanonicalTablesFromLegacy } from "./db/migrations";

export * from "./db/types";
export * from "./db/core";
export * from "./db/mappers";
export * from "./db/settings";
export * from "./db/projects";
export * from "./db/threads";
export * from "./db/cron";
export * from "./db/migrations";

syncCanonicalTablesFromLegacy();

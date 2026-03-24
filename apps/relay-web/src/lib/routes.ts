export const STUDIO_BASE_PATH = "/studio";
export const PRICING_PATH = "/pricing";
export const STUDIO_HOME_PATH = STUDIO_BASE_PATH;
export const STUDIO_LOGIN_PATH = `${STUDIO_BASE_PATH}/login`;
export const STUDIO_RELAY_SERVER_SETTINGS_PATH = `${STUDIO_LOGIN_PATH}/relay-server`;
export const STUDIO_LOGIN_CALLBACK_PATH = `${STUDIO_LOGIN_PATH}/callback`;
export const STUDIO_DEVICES_PATH = `${STUDIO_BASE_PATH}/devices`;

const LEGACY_STUDIO_PREFIXES = ["/login", "/devices", "/setup", "/integrations", "/chat", "/cron-jobs", "/config"];

export function getStudioEntryPath(isSignedIn: boolean): string {
  return isSignedIn ? STUDIO_DEVICES_PATH : STUDIO_LOGIN_PATH;
}

export function isStudioPath(pathname: string): boolean {
  return pathname === STUDIO_BASE_PATH || pathname.startsWith(`${STUDIO_BASE_PATH}/`);
}

export function isLegacyStudioPath(pathname: string): boolean {
  return LEGACY_STUDIO_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isStudioCallbackPath(pathname: string): boolean {
  return pathname === STUDIO_LOGIN_CALLBACK_PATH || pathname === "/login/callback";
}

export function buildLegacyStudioRedirectTarget(pathname: string, search = "", hash = ""): string {
  return `${STUDIO_BASE_PATH}${pathname}${search}${hash}`;
}

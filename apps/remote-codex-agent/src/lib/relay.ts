const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

export function normalizeRelayServerUrl(value: string): string {
  const input = value.trim();
  if (!input) {
    throw new Error("Relay Server URL을 입력하세요.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Relay Server URL 형식이 올바르지 않습니다.");
  }

  if (url.username || url.password) {
    throw new Error("Relay Server URL에는 사용자 정보나 비밀번호를 포함할 수 없습니다.");
  }

  const loopback = isLoopbackHost(url.hostname);
  const localHttp = url.protocol === "http:" && loopback;
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Relay Server URL은 HTTPS만 허용됩니다. 로컬 테스트에는 localhost HTTP만 사용할 수 있습니다.");
  }

  return url.origin;
}

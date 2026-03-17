import type { BridgeHttpRequestPayload, BridgeHttpResponsePayload } from "@remote-codex/contracts";

function isTextualContentType(contentType: string): boolean {
  return (
    contentType.includes("application/json") ||
    contentType.startsWith("text/") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/xml")
  );
}

export async function handleRelayTunnelRequest(input: {
  port: number;
  request: BridgeHttpRequestPayload;
}): Promise<BridgeHttpResponsePayload> {
  const { request, port } = input;
  const body =
    request.bodyEncoding === "base64" && request.body
      ? Buffer.from(request.body, "base64")
      : request.bodyEncoding === "utf8"
        ? request.body
        : undefined;

  const response = await fetch(`http://127.0.0.1:${port}${request.path}`, {
    method: request.method,
    headers: {
      ...request.headers,
      "x-remote-codex-origin": "global-ui",
    },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : ((body ?? undefined) as never),
  });

  const headers = Object.fromEntries(Array.from(response.headers.entries()));
  if (response.status === 204) {
    return {
      kind: "http.response",
      requestId: request.requestId,
      status: response.status,
      headers,
      body: null,
      bodyEncoding: "utf8",
    };
  }

  const contentType = headers["content-type"] || "";
  if (isTextualContentType(contentType)) {
    return {
      kind: "http.response",
      requestId: request.requestId,
      status: response.status,
      headers,
      body: await response.text(),
      bodyEncoding: "utf8",
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    kind: "http.response",
    requestId: request.requestId,
    status: response.status,
    headers,
    body: bytes.toString("base64"),
    bodyEncoding: "base64",
  };
}

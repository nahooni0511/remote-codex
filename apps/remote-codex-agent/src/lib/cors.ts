import type { Request, Response, NextFunction } from "express";

function getAllowedOrigins(): string[] {
  return (process.env.WEB_ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isAllowedOrigin(requestOrigin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(requestOrigin)) {
    return true;
  }

  const requestUrl = parseOrigin(requestOrigin);
  if (!requestUrl || !isLoopbackHost(requestUrl.hostname)) {
    return false;
  }

  if (!allowedOrigins.length) {
    return true;
  }

  return allowedOrigins.some((origin) => {
    const allowedUrl = parseOrigin(origin);
    return allowedUrl ? isLoopbackHost(allowedUrl.hostname) : false;
  });
}

export function corsMiddleware(request: Request, response: Response, next: NextFunction): void {
  const allowedOrigins = getAllowedOrigins();
  const requestOrigin = request.headers.origin;

  if (requestOrigin && isAllowedOrigin(requestOrigin, allowedOrigins)) {
    response.setHeader("Access-Control-Allow-Origin", requestOrigin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }

  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
}

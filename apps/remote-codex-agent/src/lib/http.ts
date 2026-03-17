import fs from "node:fs";
import path from "node:path";

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  return value.trim();
}

export function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function assertBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean.`);
  }

  return value;
}

export function parseNumericId(input: string): number {
  const numericValue = Number(input);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new HttpError(400, "Invalid numeric identifier.");
  }

  return numericValue;
}

export function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a positive integer.`);
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive integer.`);
  }

  return numericValue;
}

export function validateFolderPath(folderPath: string): string {
  const resolved = path.resolve(folderPath);

  if (!path.isAbsolute(resolved)) {
    throw new HttpError(400, "Project folder path must be an absolute path.");
  }

  if (!fs.existsSync(resolved)) {
    throw new HttpError(400, "Project folder path does not exist.");
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new HttpError(400, "Project folder path must point to a directory.");
  }

  return resolved;
}

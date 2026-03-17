import type { ProtocolMismatchReason } from "@remote-codex/contracts";

export const CURRENT_PROTOCOL_VERSION = "1.0.0";

function parseSegment(input: string | undefined): number {
  const value = Number(input || "0");
  return Number.isFinite(value) ? value : 0;
}

export function compareProtocolVersions(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const delta = parseSegment(leftParts[index]) - parseSegment(rightParts[index]);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function isProtocolCompatible(input: {
  clientVersion: string;
  serverVersion: string;
  minSupportedVersion: string;
}): boolean {
  const [clientMajor] = input.clientVersion.split(".");
  const [serverMajor] = input.serverVersion.split(".");
  if (clientMajor !== serverMajor) {
    return false;
  }

  return compareProtocolVersions(input.clientVersion, input.minSupportedVersion) >= 0;
}

export function buildProtocolMismatchReason(input: {
  requiredVersion: string;
  actualVersion: string;
  updatePathAvailable?: boolean;
}): ProtocolMismatchReason {
  return {
    requiredVersion: input.requiredVersion,
    actualVersion: input.actualVersion,
    updatePathAvailable: input.updatePathAvailable !== false,
    message: `Protocol ${input.requiredVersion}+ is required, device reported ${input.actualVersion}.`,
  };
}

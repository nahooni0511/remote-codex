const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bufferApi = (globalThis as {
  Buffer?: {
    from: (input: Uint8Array | string, encoding?: string) => Uint8Array & {
      toString: (encoding: string) => string;
    };
  };
}).Buffer;

export function encodeText(value: string): Uint8Array {
  return encoder.encode(value);
}

export function decodeText(value: Uint8Array): string {
  return decoder.decode(value);
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (bufferApi) {
    return bufferApi.from(bytes).toString("base64");
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (bufferApi) {
    return new Uint8Array(bufferApi.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

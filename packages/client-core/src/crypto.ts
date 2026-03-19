import nacl from "tweetnacl";
import type { EncryptedBridgeData, EncryptedBridgePayload } from "@remote-codex/contracts";

import { base64ToBytes, bytesToBase64, decodeText, encodeText } from "./encoding";

type RandomValuesProvider = {
  getRandomValues?: (array: Uint8Array) => Uint8Array | void;
};

function ensureNaclPrng() {
  const cryptoProvider = (globalThis as { crypto?: RandomValuesProvider }).crypto;
  if (!cryptoProvider?.getRandomValues) {
    return;
  }

  const QUOTA = 65536;
  nacl.setPRNG((target, length) => {
    for (let offset = 0; offset < length; offset += QUOTA) {
      cryptoProvider.getRandomValues?.(target.subarray(offset, offset + Math.min(length - offset, QUOTA)));
    }
  });
}

ensureNaclPrng();

export interface SessionKeyPair {
  publicKey: string;
  secretKey: string;
}

export function createSessionKeyPair(): SessionKeyPair {
  const pair = nacl.box.keyPair();
  return {
    publicKey: bytesToBase64(pair.publicKey),
    secretKey: bytesToBase64(pair.secretKey),
  };
}

export function encryptBridgeData(input: {
  data: EncryptedBridgeData;
  senderSecretKey: string;
  senderPublicKey: string;
  recipientPublicKey: string;
}): EncryptedBridgePayload {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const message = encodeText(JSON.stringify(input.data));
  const ciphertext = nacl.box(
    message,
    nonce,
    base64ToBytes(input.recipientPublicKey),
    base64ToBytes(input.senderSecretKey),
  );

  return {
    algorithm: "nacl-box",
    senderPublicKey: input.senderPublicKey,
    recipientPublicKey: input.recipientPublicKey,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  };
}

export function decryptBridgeData<T extends EncryptedBridgeData = EncryptedBridgeData>(input: {
  payload: EncryptedBridgePayload;
  recipientSecretKey: string;
}): T {
  const message = nacl.box.open(
    base64ToBytes(input.payload.ciphertext),
    base64ToBytes(input.payload.nonce),
    base64ToBytes(input.payload.senderPublicKey),
    base64ToBytes(input.recipientSecretKey),
  );

  if (!message) {
    throw new Error("Failed to decrypt relay payload.");
  }

  return JSON.parse(decodeText(message)) as T;
}

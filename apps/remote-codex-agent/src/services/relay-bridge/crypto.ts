import nacl from "tweetnacl";
import type { EncryptedBridgeData, EncryptedBridgePayload } from "@remote-codex/contracts";

import { getSetting, setSetting } from "../../db";

export type RelayKeyPair = {
  publicKey: string;
  secretKey: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function getOrCreateRelayKeys(): RelayKeyPair {
  const publicKey = getSetting("relay_device_public_key");
  const secretKey = getSetting("relay_device_secret_key");
  if (publicKey && secretKey) {
    return { publicKey, secretKey };
  }

  const pair = nacl.box.keyPair();
  const next = {
    publicKey: bytesToBase64(pair.publicKey),
    secretKey: bytesToBase64(pair.secretKey),
  };
  setSetting("relay_device_public_key", next.publicKey);
  setSetting("relay_device_secret_key", next.secretKey);
  return next;
}

export function decryptRelayPayload(input: {
  payload: Pick<EncryptedBridgePayload, "senderPublicKey" | "nonce" | "ciphertext">;
  secretKey: string;
}): EncryptedBridgeData {
  const plaintext = nacl.box.open(
    base64ToBytes(input.payload.ciphertext),
    base64ToBytes(input.payload.nonce),
    base64ToBytes(input.payload.senderPublicKey),
    base64ToBytes(input.secretKey),
  );

  if (!plaintext) {
    throw new Error("Failed to decrypt relay payload.");
  }

  return JSON.parse(Buffer.from(plaintext).toString("utf8")) as EncryptedBridgeData;
}

export function encryptRelayPayload(input: {
  data: EncryptedBridgeData;
  senderPublicKey: string;
  senderSecretKey: string;
  recipientPublicKey: string;
}): EncryptedBridgePayload {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = Buffer.from(JSON.stringify(input.data), "utf8");
  const ciphertext = nacl.box(
    new Uint8Array(plaintext),
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

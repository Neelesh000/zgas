/**
 * Note generation and serialization for the Privacy Paymaster protocol.
 *
 * A Note encapsulates:
 *   - secret: random 31-byte value
 *   - nullifier: random 31-byte value
 *   - commitment: Poseidon(secret, nullifier) — the on-chain leaf
 *   - nullifierHash: Poseidon(nullifier) — revealed at withdrawal
 *   - sponsorshipNullifierHash: Poseidon(nullifier, 2) — domain-separated for paymaster
 */

import { poseidonHash1, poseidonHash2 } from "./merkle";
import type { Field, Note } from "./types";

/** BN254 scalar field order (the snark field). */
const SNARK_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

/**
 * Generate a cryptographically random field element (< SNARK_FIELD).
 * Uses 31 bytes of randomness to stay safely within the field.
 */
function randomFieldElement(): Field {
  // Use globalThis.crypto for both Node.js and browser environments
  const buf = new Uint8Array(31);
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // Fallback for Node.js environments without globalThis.crypto
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomBytes } = require("crypto") as typeof import("crypto");
    const nodeBuf = randomBytes(31);
    buf.set(nodeBuf);
  }

  let value = BigInt(0);
  for (let i = 0; i < buf.length; i++) {
    value = (value << BigInt(8)) | BigInt(buf[i]);
  }
  return value % SNARK_FIELD;
}

/**
 * Generate a new Note with random secret and nullifier.
 * Derives commitment, nullifierHash, and sponsorshipNullifierHash using Poseidon.
 *
 * @returns A fully populated Note.
 */
export async function generateNote(): Promise<Note> {
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();

  const commitment = await poseidonHash2(secret, nullifier);
  const nullifierHash = await poseidonHash1(nullifier);
  const sponsorshipNullifierHash = await poseidonHash2(nullifier, BigInt(2));

  return {
    secret,
    nullifier,
    commitment,
    nullifierHash,
    sponsorshipNullifierHash,
  };
}

/**
 * Re-derive a Note from an existing secret and nullifier.
 * Useful when restoring a note from stored secrets.
 *
 * @param secret The secret field element.
 * @param nullifier The nullifier field element.
 * @returns A fully populated Note.
 */
export async function deriveNote(secret: Field, nullifier: Field): Promise<Note> {
  const commitment = await poseidonHash2(secret, nullifier);
  const nullifierHash = await poseidonHash1(nullifier);
  const sponsorshipNullifierHash = await poseidonHash2(nullifier, BigInt(2));

  return {
    secret,
    nullifier,
    commitment,
    nullifierHash,
    sponsorshipNullifierHash,
  };
}

/**
 * Serialize a Note to a hex-encoded string.
 * Format: `0x<secret_hex_64><nullifier_hex_64>`
 * The derived fields (commitment, nullifierHash, sponsorshipNullifierHash) are
 * re-derived on deserialization, so only secret and nullifier are stored.
 *
 * @param note The Note to serialize.
 * @returns A hex string encoding the note's secret material.
 */
export function serializeNote(note: Note): string {
  const secretHex = note.secret.toString(16).padStart(64, "0");
  const nullifierHex = note.nullifier.toString(16).padStart(64, "0");
  return `0x${secretHex}${nullifierHex}`;
}

/**
 * Deserialize a hex-encoded note string back into a Note.
 *
 * @param serialized The hex string produced by serializeNote.
 * @returns A fully populated Note with derived fields recomputed.
 */
export async function deserializeNote(serialized: string): Promise<Note> {
  const hex = serialized.startsWith("0x") ? serialized.slice(2) : serialized;
  if (hex.length !== 128) {
    throw new Error(`Invalid serialized note length: expected 128 hex chars, got ${hex.length}`);
  }

  const secret = BigInt("0x" + hex.slice(0, 64));
  const nullifier = BigInt("0x" + hex.slice(64, 128));

  return deriveNote(secret, nullifier);
}

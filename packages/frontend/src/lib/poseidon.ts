/**
 * Cached Poseidon hash functions for the frontend.
 * Uses circomlibjs (wasm-backed) — same implementation as the SDK.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _poseidon: any = null;

/** Lazily initialize and cache the Poseidon instance. */
export async function getPoseidon() {
  if (!_poseidon) {
    const { buildPoseidon } = await import("circomlibjs");
    _poseidon = await buildPoseidon();
  }
  return _poseidon;
}

/** Poseidon(left, right) — 2-input hash, returns bigint. */
export async function poseidonHash2(left: bigint, right: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon([left, right]);
  return BigInt(poseidon.F.toObject(hash));
}

/** Poseidon(input) — 1-input hash, returns bigint. */
export async function poseidonHash1(input: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon([input]);
  return BigInt(poseidon.F.toObject(hash));
}

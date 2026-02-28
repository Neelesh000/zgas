declare module "circomlibjs" {
  export function buildPoseidon(): Promise<PoseidonFunction>;

  interface PoseidonFunction {
    (inputs: bigint[]): Uint8Array;
    F: {
      toObject(hash: Uint8Array): bigint;
    };
  }
}

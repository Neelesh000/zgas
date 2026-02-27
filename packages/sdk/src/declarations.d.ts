declare module 'circomlibjs' {
  export type Poseidon = {
    (inputs: (bigint | number | string)[]): Uint8Array;
    F: {
      toObject(val: Uint8Array): bigint;
      toString(val: Uint8Array, radix?: number): string;
    };
  };
  export function buildPoseidon(): Promise<Poseidon>;
}

declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{
      proof: {
        pi_a: string[];
        pi_b: string[][];
        pi_c: string[];
        protocol: string;
        curve: string;
      };
      publicSignals: string[];
    }>;
    verify(
      vkey: unknown,
      publicSignals: string[],
      proof: unknown
    ): Promise<boolean>;
  };
}

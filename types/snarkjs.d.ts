declare module "snarkjs" {
  // A circuit signal is a field element (string/number/bigint) or an array of
  // them (e.g. Merkle `pathElements` / `pathIndices`) — snarkjs' real input shape.
  type CircuitSignal = string | number | bigint;
  export const groth16: {
    fullProve(
      input: Record<string, CircuitSignal | CircuitSignal[]>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: unknown; publicSignals: unknown }>;
    verify(vk: unknown, publicSignals: unknown, proof: unknown): Promise<boolean>;
  };
}

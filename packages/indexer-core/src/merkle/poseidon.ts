import { buildPoseidon } from "circomlibjs";

export interface Poseidon2 {
  poseidon2(a: bigint, b: bigint): bigint;
}

let cached: Promise<Poseidon2> | undefined;

/**
 * Lazily builds the (WASM-backed) Poseidon(2) hasher once and caches it for the
 * process lifetime — same lazy-build pattern as packages/wallet-core's own
 * poseidon.ts, trimmed to just poseidon2 since Merkle tree hashing never needs
 * poseidon4/commitment/nullifier. Those are note-plaintext concerns; this package
 * never sees note plaintext at all (see the privacy note in CLAUDE.md's "Indexer:
 * Full Design & Public Distribution Plan" — the indexer stores only opaque
 * commitments and ciphertext, never anything it could hash a real note from).
 */
export function getPoseidon(): Promise<Poseidon2> {
  if (!cached) {
    cached = (buildPoseidon() as Promise<unknown>).then((poseidon: unknown) => {
      const p = poseidon as ((inputs: bigint[]) => unknown) & { F: { toString(x: unknown): string } };
      const poseidon2 = (a: bigint, b: bigint): bigint => BigInt(p.F.toString(p([a, b])));
      return { poseidon2 };
    });
  }
  return cached;
}

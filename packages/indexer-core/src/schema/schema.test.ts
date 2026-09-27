import { HealthResponseSchema } from "./health";
import { PoolsResponseSchema } from "./pools";
import { ContractsResponseSchema } from "./contracts";
import { EventsQuerySchema, EventsResponseSchema, MAX_EVENTS_BLOCK_RANGE, PoolEventSchema } from "./events";
import { MERKLE_TREE_DEPTH, MerkleProofResponseSchema } from "./merkleProof";
import { API_CONTRACT_VERSION } from "./version";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const HASH = "0x" + "ab".repeat(32);

describe("HealthResponseSchema", () => {
  it("parses a real-shaped multi-network response", () => {
    const parsed = HealthResponseSchema.parse({
      status: "healthy",
      contractVersion: API_CONTRACT_VERSION,
      capabilities: { subscribe: true },
      networks: {
        "base-sepolia": {
          chainId: 84532,
          isTestnet: true,
          state: "synced",
          lastProcessedBlock: 46412345,
          chainHeadBlock: 46412346,
          blocksBehind: 1,
        },
        base: {
          chainId: 8453,
          isTestnet: false,
          state: "down",
          lastProcessedBlock: 0,
          chainHeadBlock: 0,
          blocksBehind: 0,
        },
      },
    });
    expect(parsed.networks["base-sepolia"].state).toBe("synced");
  });

  it("rejects an unknown status value", () => {
    expect(() =>
      HealthResponseSchema.parse({
        status: "unknown",
        contractVersion: "1.0.0",
        capabilities: { subscribe: false },
        networks: {},
      }),
    ).toThrow();
  });
});

describe("PoolsResponseSchema", () => {
  it("parses a pool row with default (unset) capability flags", () => {
    const parsed = PoolsResponseSchema.parse({
      pools: [
        {
          chainId: 84532,
          asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          poolAddress: ADDRESS,
          version: "v1",
          deploymentBlock: 45816777,
          verifiers: {
            deposit: ADDRESS,
            transfer: ADDRESS,
            withdraw: ADDRESS,
          },
          circuitArtifactHash: HASH,
          isCurrent: true,
          supersededByPoolAddress: null,
        },
      ],
    });
    expect(parsed.pools[0].supports2Input).toBe(false);
  });
});

describe("ContractsResponseSchema", () => {
  it("accepts a forward-unknown contract kind without failing", () => {
    const parsed = ContractsResponseSchema.parse({
      contracts: [
        {
          chainId: 84532,
          kind: "SomeFutureContractKindNotYetDocumented",
          address: ADDRESS,
          deploymentBlock: 1,
          isCurrent: true,
          supersededByAddress: null,
        },
      ],
    });
    expect(parsed.contracts[0].kind).toBe("SomeFutureContractKindNotYetDocumented");
  });
});

describe("EventsQuerySchema", () => {
  it("accepts a range within the cap", () => {
    expect(() => EventsQuerySchema.parse({ fromBlock: 100, toBlock: 100 + MAX_EVENTS_BLOCK_RANGE })).not.toThrow();
  });

  it("rejects a range exceeding the cap, forcing pagination", () => {
    expect(() => EventsQuerySchema.parse({ fromBlock: 0, toBlock: MAX_EVENTS_BLOCK_RANGE + 1 })).toThrow();
  });

  it("rejects an inverted range", () => {
    expect(() => EventsQuerySchema.parse({ fromBlock: 100, toBlock: 50 })).toThrow();
  });
});

describe("PoolEventSchema (discriminated union)", () => {
  const meta = { poolAddress: ADDRESS, blockNumber: 1, transactionHash: HASH, logIndex: 0 };

  it("discriminates every real ShieldedPool event type correctly", () => {
    const cases = [
      { ...meta, type: "Deposit" as const, commitment: HASH, leafIndex: 0, amount: "1000000000000000", envelope: "0x1234" },
      { ...meta, type: "Transfer" as const, nullifier: HASH, outputCommitment: HASH, changeCommitment: HASH, outputEnvelope: "0x", changeEnvelope: "0x" },
      { ...meta, type: "Withdrawal" as const, nullifier: HASH, recipient: ADDRESS, amount: "500", changeCommitment: HASH, changeEnvelope: "0x" },
      { ...meta, type: "Transfer2" as const, nullifier1: HASH, nullifier2: HASH, outputCommitment: HASH, changeCommitment: HASH, outputEnvelope: "0x", changeEnvelope: "0x" },
      { ...meta, type: "Withdrawal2" as const, nullifier1: HASH, nullifier2: HASH, recipient: ADDRESS, amount: "500", changeCommitment: HASH, changeEnvelope: "0x" },
      { ...meta, type: "LeafInserted" as const, leafIndex: 2, leaf: HASH, root: HASH },
    ];
    for (const c of cases) {
      expect(() => PoolEventSchema.parse(c)).not.toThrow();
    }
  });

  it("rejects a non-decimal amount (e.g. a hex string, guarding against precision-loss shortcuts)", () => {
    expect(() =>
      PoolEventSchema.parse({ ...meta, type: "Withdrawal", nullifier: HASH, recipient: ADDRESS, amount: "0x1f4", changeCommitment: HASH, changeEnvelope: "0x" }),
    ).toThrow();
  });

  it("rejects an unrecognized event type", () => {
    expect(() => PoolEventSchema.parse({ ...meta, type: "SomethingElse" })).toThrow();
  });
});

describe("EventsResponseSchema", () => {
  it("wraps a mixed list of real event shapes", () => {
    const parsed = EventsResponseSchema.parse({
      events: [
        { poolAddress: ADDRESS, blockNumber: 1, transactionHash: HASH, logIndex: 0, type: "LeafInserted", leafIndex: 0, leaf: HASH, root: HASH },
      ],
    });
    expect(parsed.events).toHaveLength(1);
  });
});

describe("MerkleProofResponseSchema", () => {
  it("requires exactly MERKLE_TREE_DEPTH siblings and path indices", () => {
    const valid = {
      poolAddress: ADDRESS,
      leafIndex: 5,
      leaf: HASH,
      siblings: Array(MERKLE_TREE_DEPTH).fill(HASH),
      pathIndices: Array(MERKLE_TREE_DEPTH).fill(0),
      root: HASH,
      treeSize: 6,
    };
    expect(() => MerkleProofResponseSchema.parse(valid)).not.toThrow();

    const tooShort = { ...valid, siblings: Array(MERKLE_TREE_DEPTH - 1).fill(HASH) };
    expect(() => MerkleProofResponseSchema.parse(tooShort)).toThrow();
  });

  it("rejects a pathIndices entry outside {0,1}", () => {
    const invalid = {
      poolAddress: ADDRESS,
      leafIndex: 0,
      leaf: HASH,
      siblings: Array(MERKLE_TREE_DEPTH).fill(HASH),
      pathIndices: [...Array(MERKLE_TREE_DEPTH - 1).fill(0), 2],
      root: HASH,
      treeSize: 1,
    };
    expect(() => MerkleProofResponseSchema.parse(invalid)).toThrow();
  });
});

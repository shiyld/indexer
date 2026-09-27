import type { EventLog } from "ethers";
import { parsePoolEvent } from "./eventParser";

const POOL = "0x1111111111111111111111111111111111111111";
const HASH = "0x" + "cd".repeat(32);

/** A minimal fake shaped like ethers' real EventLog — only the fields
 * parsePoolEvent actually reads (eventName, args.*, blockNumber,
 * transactionHash, index). Real field NAMES verified against SHIELDED_POOL_ABI
 * in @shiyld/shared; this test isn't re-verifying ethers' own log decoding, only
 * that parsePoolEvent maps those named args into our schema shapes correctly. */
function fakeLog(eventName: string, args: Record<string, unknown>): EventLog {
  return {
    eventName,
    args,
    blockNumber: 100,
    transactionHash: HASH,
    index: 3,
  } as unknown as EventLog;
}

describe("parsePoolEvent", () => {
  it("parses Deposit, converting amount to a decimal string", () => {
    const event = parsePoolEvent(POOL, fakeLog("Deposit", { commitment: HASH, leafIndex: 5n, amount: 1000000000000000n, envelope: "0xabcd" }));
    expect(event).toEqual({
      poolAddress: POOL,
      blockNumber: 100,
      transactionHash: HASH,
      logIndex: 3,
      type: "Deposit",
      commitment: HASH,
      leafIndex: 5,
      amount: "1000000000000000",
      envelope: "0xabcd",
    });
  });

  it("parses Transfer", () => {
    const event = parsePoolEvent(
      POOL,
      fakeLog("Transfer", { nullifier: HASH, outputCommitment: HASH, changeCommitment: HASH, outputEnvelope: "0x01", changeEnvelope: "0x02" }),
    );
    expect(event.type).toBe("Transfer");
    if (event.type === "Transfer") {
      expect(event.outputEnvelope).toBe("0x01");
      expect(event.changeEnvelope).toBe("0x02");
    }
  });

  it("parses Withdrawal, converting amount to a decimal string", () => {
    const event = parsePoolEvent(
      POOL,
      fakeLog("Withdrawal", { nullifier: HASH, recipient: POOL, amount: 500n, changeCommitment: HASH, changeEnvelope: "0x" }),
    );
    expect(event.type).toBe("Withdrawal");
    if (event.type === "Withdrawal") {
      expect(event.amount).toBe("500");
      expect(event.recipient).toBe(POOL);
    }
  });

  it("parses Transfer2 with both nullifiers", () => {
    const event = parsePoolEvent(
      POOL,
      fakeLog("Transfer2", {
        nullifier1: HASH,
        nullifier2: HASH,
        outputCommitment: HASH,
        changeCommitment: HASH,
        outputEnvelope: "0x",
        changeEnvelope: "0x",
      }),
    );
    expect(event.type).toBe("Transfer2");
  });

  it("parses Withdrawal2 with both nullifiers and a decimal amount", () => {
    const event = parsePoolEvent(
      POOL,
      fakeLog("Withdrawal2", { nullifier1: HASH, nullifier2: HASH, recipient: POOL, amount: 42n, changeCommitment: HASH, changeEnvelope: "0x" }),
    );
    expect(event.type).toBe("Withdrawal2");
    if (event.type === "Withdrawal2") expect(event.amount).toBe("42");
  });

  it("parses LeafInserted", () => {
    const event = parsePoolEvent(POOL, fakeLog("LeafInserted", { leafIndex: 7n, leaf: HASH, root: HASH }));
    expect(event).toMatchObject({ type: "LeafInserted", leafIndex: 7, leaf: HASH, root: HASH });
  });

  it("throws on an unrecognized event name rather than silently mis-parsing it", () => {
    expect(() => parsePoolEvent(POOL, fakeLog("SomeFutureEvent", {}))).toThrow(/Unrecognized ShieldedPool event/);
  });
});

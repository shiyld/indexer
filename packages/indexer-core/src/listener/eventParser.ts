import type { EventLog } from "ethers";
import type { PoolEvent } from "../schema/events";

/**
 * The six real ShieldedPool event names — verified directly against
 * SHIELDED_POOL_ABI in @shiyld/shared (packages/shared/src/abi/shieldedPool.ts),
 * matching the exact same set the schema's PoolEventSchema discriminated union
 * covers. Re-verify both places if ShieldedPool.sol's events ever change.
 */
export const SHIELDED_POOL_EVENT_NAMES = [
  "Deposit",
  "Transfer",
  "Withdrawal",
  "Transfer2",
  "Withdrawal2",
  "LeafInserted",
] as const;
export type ShieldedPoolEventName = (typeof SHIELDED_POOL_EVENT_NAMES)[number];

/**
 * Converts a raw ethers EventLog into the typed, zod-validated PoolEvent shape
 * this package persists/serves. Amounts are always converted to decimal strings
 * (never left as ethers' native bigint) — see schema/common.ts's Uint256StringSchema
 * for why.
 */
export function parsePoolEvent(poolAddress: string, log: EventLog): PoolEvent {
  const meta = {
    poolAddress,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.index,
  };

  switch (log.eventName as ShieldedPoolEventName) {
    case "Deposit":
      return {
        ...meta,
        type: "Deposit",
        commitment: log.args.commitment as string,
        leafIndex: Number(log.args.leafIndex),
        amount: (log.args.amount as bigint).toString(),
        envelope: log.args.envelope as string,
      };
    case "Transfer":
      return {
        ...meta,
        type: "Transfer",
        nullifier: log.args.nullifier as string,
        outputCommitment: log.args.outputCommitment as string,
        changeCommitment: log.args.changeCommitment as string,
        outputEnvelope: log.args.outputEnvelope as string,
        changeEnvelope: log.args.changeEnvelope as string,
      };
    case "Withdrawal":
      return {
        ...meta,
        type: "Withdrawal",
        nullifier: log.args.nullifier as string,
        recipient: log.args.recipient as string,
        amount: (log.args.amount as bigint).toString(),
        changeCommitment: log.args.changeCommitment as string,
        changeEnvelope: log.args.changeEnvelope as string,
      };
    case "Transfer2":
      return {
        ...meta,
        type: "Transfer2",
        nullifier1: log.args.nullifier1 as string,
        nullifier2: log.args.nullifier2 as string,
        outputCommitment: log.args.outputCommitment as string,
        changeCommitment: log.args.changeCommitment as string,
        outputEnvelope: log.args.outputEnvelope as string,
        changeEnvelope: log.args.changeEnvelope as string,
      };
    case "Withdrawal2":
      return {
        ...meta,
        type: "Withdrawal2",
        nullifier1: log.args.nullifier1 as string,
        nullifier2: log.args.nullifier2 as string,
        recipient: log.args.recipient as string,
        amount: (log.args.amount as bigint).toString(),
        changeCommitment: log.args.changeCommitment as string,
        changeEnvelope: log.args.changeEnvelope as string,
      };
    case "LeafInserted":
      return {
        ...meta,
        type: "LeafInserted",
        leafIndex: Number(log.args.leafIndex),
        leaf: log.args.leaf as string,
        root: log.args.root as string,
      };
    default:
      throw new Error(`Unrecognized ShieldedPool event: ${log.eventName}`);
  }
}

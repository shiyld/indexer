import { z } from "zod";
import { AddressSchema, BlockNumberSchema, Bytes32Schema, HexStringSchema, Uint256StringSchema } from "./common";

/**
 * Maximum block span a single Quick Sync request may cover — forces pagination
 * rather than letting one request drive an unbounded DB scan (see CLAUDE.md's
 * "Indexer: Full Design & Public Distribution Plan," Hardening).
 */
export const MAX_EVENTS_BLOCK_RANGE = 50_000;

const EventMetaSchema = z.object({
  poolAddress: AddressSchema,
  blockNumber: BlockNumberSchema,
  transactionHash: Bytes32Schema,
  logIndex: z.number().int().nonnegative(),
});

/**
 * Every variant's fields are verified directly against SHIELDED_POOL_ABI in
 * @shiyld/shared (packages/shared/src/abi/shieldedPool.ts) — re-verify there if
 * ShieldedPool.sol's events ever change. Amounts are decimal strings (see
 * Uint256StringSchema), never JS numbers.
 */
export const DepositEventSchema = EventMetaSchema.extend({
  type: z.literal("Deposit"),
  commitment: Bytes32Schema,
  leafIndex: z.number().int().nonnegative(),
  amount: Uint256StringSchema,
  envelope: HexStringSchema,
});
export type DepositEvent = z.infer<typeof DepositEventSchema>;

export const TransferEventSchema = EventMetaSchema.extend({
  type: z.literal("Transfer"),
  nullifier: Bytes32Schema,
  outputCommitment: Bytes32Schema,
  changeCommitment: Bytes32Schema,
  outputEnvelope: HexStringSchema,
  changeEnvelope: HexStringSchema,
});
export type TransferEvent = z.infer<typeof TransferEventSchema>;

export const WithdrawalEventSchema = EventMetaSchema.extend({
  type: z.literal("Withdrawal"),
  nullifier: Bytes32Schema,
  recipient: AddressSchema,
  amount: Uint256StringSchema,
  changeCommitment: Bytes32Schema,
  changeEnvelope: HexStringSchema,
});
export type WithdrawalEvent = z.infer<typeof WithdrawalEventSchema>;

export const Transfer2EventSchema = EventMetaSchema.extend({
  type: z.literal("Transfer2"),
  nullifier1: Bytes32Schema,
  nullifier2: Bytes32Schema,
  outputCommitment: Bytes32Schema,
  changeCommitment: Bytes32Schema,
  outputEnvelope: HexStringSchema,
  changeEnvelope: HexStringSchema,
});
export type Transfer2Event = z.infer<typeof Transfer2EventSchema>;

export const Withdrawal2EventSchema = EventMetaSchema.extend({
  type: z.literal("Withdrawal2"),
  nullifier1: Bytes32Schema,
  nullifier2: Bytes32Schema,
  recipient: AddressSchema,
  amount: Uint256StringSchema,
  changeCommitment: Bytes32Schema,
  changeEnvelope: HexStringSchema,
});
export type Withdrawal2Event = z.infer<typeof Withdrawal2EventSchema>;

/** The authoritative, order-correct source for Merkle tree reconstruction — emitted
 * once per leaf insertion, disambiguating multi-leaf calls (transfer/withdraw)
 * without relying on contract-internal insert-order knowledge. */
export const LeafInsertedEventSchema = EventMetaSchema.extend({
  type: z.literal("LeafInserted"),
  leafIndex: z.number().int().nonnegative(),
  leaf: Bytes32Schema,
  root: Bytes32Schema,
});
export type LeafInsertedEvent = z.infer<typeof LeafInsertedEventSchema>;

export const PoolEventSchema = z.discriminatedUnion("type", [
  DepositEventSchema,
  TransferEventSchema,
  WithdrawalEventSchema,
  Transfer2EventSchema,
  Withdrawal2EventSchema,
  LeafInsertedEventSchema,
]);
export type PoolEvent = z.infer<typeof PoolEventSchema>;

/** GET /<network>/pools/:poolAddress/events?fromBlock=&toBlock= ("Quick Sync") */
export const EventsQuerySchema = z
  .object({
    fromBlock: BlockNumberSchema,
    toBlock: BlockNumberSchema,
  })
  .refine((q) => q.toBlock >= q.fromBlock, { message: "toBlock must be >= fromBlock" })
  .refine((q) => q.toBlock - q.fromBlock <= MAX_EVENTS_BLOCK_RANGE, {
    message: `range exceeds the maximum of ${MAX_EVENTS_BLOCK_RANGE} blocks — paginate instead`,
  });
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const EventsResponseSchema = z.object({
  events: z.array(PoolEventSchema),
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

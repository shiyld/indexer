import { z } from "zod";
import { AddressSchema, BlockNumberSchema } from "./common";

/**
 * A non-pool protocol contract (everything ShieldedPool isn't — $SYD, PoolFactory,
 * Governor, Timelock, Staking, Treasury, ParameterRegistry, EpochManager, ...).
 * `kind` is deliberately an open string rather than a closed enum: new contract
 * kinds will exist long before this schema gets a version bump for them, and an
 * older client encountering an unrecognized kind should just ignore that row, not
 * fail to parse the whole response.
 */
export const ProtocolContractSchema = z.object({
  chainId: z.number().int().positive(),
  kind: z.string(),
  address: AddressSchema,
  deploymentBlock: BlockNumberSchema,
  isCurrent: z.boolean(),
  supersededByAddress: AddressSchema.nullable(),
});
export type ProtocolContract = z.infer<typeof ProtocolContractSchema>;

/** GET /<network>/contracts */
export const ContractsResponseSchema = z.object({
  contracts: z.array(ProtocolContractSchema),
});
export type ContractsResponse = z.infer<typeof ContractsResponseSchema>;

import { z } from "zod";
import { AddressSchema, BlockNumberSchema } from "./common";

/**
 * Verifier contract addresses a pool version was deployed with. transfer2/withdraw2
 * are optional — only pools deployed v6+ have them (see @shiyld/shared's
 * AssetConfig.supports2Input).
 */
export const PoolVerifiersSchema = z.object({
  deposit: AddressSchema,
  transfer: AddressSchema,
  withdraw: AddressSchema,
  transfer2: AddressSchema.optional(),
  withdraw2: AddressSchema.optional(),
});
export type PoolVerifiers = z.infer<typeof PoolVerifiersSchema>;

/**
 * One row per deployed ShieldedPool version — current or superseded, never dropped
 * (a user may still hold a note in an old version). Capability flags deliberately
 * mirror @shiyld/shared's AssetConfig field names exactly
 * (supports2Input/supportsDepositCiphertext/supportsFeeEnforcement) — this registry
 * is the richer, queryable superset of that static bootstrap source, not a different
 * shape for the same facts.
 */
export const PoolSchema = z.object({
  chainId: z.number().int().positive(),
  asset: AddressSchema,
  poolAddress: AddressSchema,
  /** Internal/dated version label (e.g. "v7") or the public-facing "v1" branding —
   * see CLAUDE.md's "Public Version Branding" section. Free-form on purpose, since
   * the two numbering schemes deliberately never merge. */
  version: z.string(),
  deploymentBlock: BlockNumberSchema,
  verifiers: PoolVerifiersSchema,
  /** Ties a pool to the exact circuit generation it was proven against — see the
   * "stale zkey vs. verifier" bug class documented under Note Ownership Model's
   * Operational Lesson in CLAUDE.md. Nullable: no infrastructure computes this yet,
   * intentionally left unpopulated rather than seeded with a fabricated value. */
  circuitArtifactHash: z.string().nullable(),
  isCurrent: z.boolean(),
  supersededByPoolAddress: AddressSchema.nullable(),
  supports2Input: z.boolean().default(false),
  supportsDepositCiphertext: z.boolean().default(false),
  supportsFeeEnforcement: z.boolean().default(false),
});
export type Pool = z.infer<typeof PoolSchema>;

/** GET /<network>/pools?asset= */
export const PoolsQuerySchema = z.object({
  asset: AddressSchema.optional(),
});
export type PoolsQuery = z.infer<typeof PoolsQuerySchema>;

export const PoolsResponseSchema = z.object({
  pools: z.array(PoolSchema),
});
export type PoolsResponse = z.infer<typeof PoolsResponseSchema>;

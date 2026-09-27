import { z } from "zod";

/**
 * A 0x-prefixed hex string of any length — used for opaque byte blobs (Stealth
 * Notes envelopes) where exact length isn't fixed. Addresses and 32-byte hashes get
 * their own stricter schemas below rather than reusing this loosely.
 */
export const HexStringSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, "expected a 0x-prefixed hex string");

/** A 20-byte EVM address. */
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte (40 hex char) address");

/** A 32-byte hash — commitments, nullifiers, Merkle roots/leaves/siblings. */
export const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte (64 hex char) hash");

/**
 * A network path-segment slug (e.g. "base-sepolia"). Deliberately a loose non-empty
 * string, not a closed enum against @shiyld/shared's current NETWORKS registry — the
 * set of networks an indexer instance serves grows over time (new chains, self-hosted
 * instances tracking their own subset), and a client running an older schema version
 * must not fail to parse a response just because it lists a network the client
 * doesn't recognize yet.
 */
export const NetworkSlugSchema = z.string().min(1);

export const BlockNumberSchema = z.number().int().nonnegative();

/**
 * uint256 values (amounts) are always transmitted as decimal strings, never as JS
 * numbers — a JS `number` loses precision above 2^53, which real on-chain amounts
 * (raw wei/smallest-unit values) can easily exceed.
 */
export const Uint256StringSchema = z.string().regex(/^[0-9]+$/, "expected a decimal-string uint256");

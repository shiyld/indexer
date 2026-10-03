-- Pools number their notes with a 64-bit leaf index, global across trees (pre-mainnet
-- hardening: tree rollover and a 64-bit counter). INTEGER tops out at 2^31 − 1, so
-- widen it. pg returns BIGINT as a string; readers convert with Number(), which is
-- exact up to 2^53 leaves.
ALTER TABLE merkle_leaves ALTER COLUMN leaf_index TYPE BIGINT;

// circomlibjs ships no type declarations. Declared as `any` — call sites cast to
// `bigint` explicitly where the shape is known (see merkle/poseidon.ts). Same shim
// as packages/wallet-core/src/types/circomlibjs.d.ts.
declare module "circomlibjs";

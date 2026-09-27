import { Contract, JsonRpcProvider, type EventLog } from "ethers";
import { SHIELDED_POOL_ABI, ETH_ADDRESS } from "@shiyld/shared";
import { withRetry } from "./retry";
import { SHIELDED_POOL_EVENT_NAMES } from "./eventParser";

const ERC20_BALANCE_ABI = ["function balanceOf(address) view returns (uint256)"];

/**
 * Everything poolIngestion.ts needs from the chain, behind one small interface —
 * lets tests inject a fake implementation instead of hitting a real network, while
 * production code uses createEthersPoolChainClient below.
 */
export interface PoolChainClient {
  getEventsInRange(fromBlock: number, toBlock: number): Promise<EventLog[]>;
  /** A historical, block-pinned read — never the contract's live/current root — so
   * comparing it against a specific past LeafInserted event's own root field is a
   * genuine apples-to-apples check, not a race against blocks mined in between. */
  getRootAt(blockTag: number): Promise<string>;
  getBalance(asset: string, poolAddress: string, blockTag: number): Promise<bigint>;
}

/** Real ethers-backed implementation, used in production. */
export function createEthersPoolChainClient(provider: JsonRpcProvider, poolAddress: string): PoolChainClient {
  const contract = new Contract(poolAddress, SHIELDED_POOL_ABI, provider);

  return {
    async getEventsInRange(fromBlock, toBlock) {
      const perType = await Promise.all(
        SHIELDED_POOL_EVENT_NAMES.map((name) =>
          withRetry(() => contract.queryFilter(contract.filters[name]!(), fromBlock, toBlock)),
        ),
      );
      return (perType.flat() as EventLog[]).sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    },
    async getRootAt(blockTag) {
      return withRetry(() => contract.root!({ blockTag })) as unknown as Promise<string>;
    },
    async getBalance(asset, address, blockTag) {
      if (asset.toLowerCase() === ETH_ADDRESS.toLowerCase()) {
        return withRetry(() => provider.getBalance(address, blockTag));
      }
      const token = new Contract(asset, ERC20_BALANCE_ABI, provider);
      return withRetry(() => token.balanceOf!(address, { blockTag })) as unknown as Promise<bigint>;
    },
  };
}

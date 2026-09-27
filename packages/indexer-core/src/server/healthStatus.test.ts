import { computeServiceStatus, buildHealthResponse } from "./healthStatus";
import type { NetworkListenerStatus } from "../listener/networkListener";

function status(overrides: Partial<NetworkListenerStatus>): NetworkListenerStatus {
  return { chainId: 84532, state: "synced", lastProcessedBlock: 100, chainHeadBlock: 100, blocksBehind: 0, ...overrides };
}

describe("computeServiceStatus", () => {
  it("is 'failed' whenever the DB is unreachable, regardless of network state", () => {
    expect(computeServiceStatus(false, [status({ state: "synced" })])).toBe("failed");
    expect(computeServiceStatus(false, [])).toBe("failed");
  });

  it("is 'healthy' only when every configured network is fully synced", () => {
    expect(computeServiceStatus(true, [status({ state: "synced" }), status({ chainId: 8453, state: "synced" })])).toBe("healthy");
  });

  it("is 'healthy' with zero configured networks (nothing to be out of sync)", () => {
    expect(computeServiceStatus(true, [])).toBe("healthy");
  });

  it("is 'degraded' if even one network isn't synced, without needing the process itself to be broken", () => {
    expect(computeServiceStatus(true, [status({ state: "synced" }), status({ chainId: 8453, state: "syncing" })])).toBe("degraded");
    expect(computeServiceStatus(true, [status({ state: "down" })])).toBe("degraded");
  });
});

describe("buildHealthResponse", () => {
  it("keys networks by their canonical slug and includes per-network freshness detail", () => {
    const body = buildHealthResponse(true, [status({ chainId: 84532 })], { subscribe: true });
    expect(body.networks["base-sepolia"]).toMatchObject({ chainId: 84532, isTestnet: true, state: "synced" });
    expect(body.capabilities).toEqual({ subscribe: true });
  });

  it("falls back to the raw chainId as the key for a chain not yet in the NETWORKS registry", () => {
    const body = buildHealthResponse(true, [status({ chainId: 999999 })], { subscribe: false });
    expect(body.networks["999999"]).toMatchObject({ chainId: 999999, isTestnet: false });
  });
});

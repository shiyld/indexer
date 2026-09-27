import express from "express";
import request from "supertest";
import { createRateLimitMiddleware } from "./rateLimit";

describe("createRateLimitMiddleware", () => {
  it("allows requests up to the configured limit, then rejects with 429", async () => {
    const app = express();
    app.use(createRateLimitMiddleware(3));
    app.get("/thing", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    expect((await agent.get("/thing")).status).toBe(200);
    expect((await agent.get("/thing")).status).toBe(200);
    expect((await agent.get("/thing")).status).toBe(200);
    expect((await agent.get("/thing")).status).toBe(429);
  });

  it("gives independent limits to different API keys, not one shared IP bucket", async () => {
    const app = express();
    app.use(createRateLimitMiddleware(1));
    app.get("/thing", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    expect((await agent.get("/thing").set("x-indexer-api-key", "key-a")).status).toBe(200);
    expect((await agent.get("/thing").set("x-indexer-api-key", "key-a")).status).toBe(429);
    // A different key gets its own fresh bucket, even from the same test client.
    expect((await agent.get("/thing").set("x-indexer-api-key", "key-b")).status).toBe(200);
  });
});

import express from "express";
import request from "supertest";
import { createAccessControlConfig } from "./accessControl";
import { createAccessModeMiddleware } from "./accessMode";

function appWith(config: ReturnType<typeof createAccessControlConfig>) {
  const app = express();
  app.use(createAccessModeMiddleware(config));
  app.get("/thing", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createAccessModeMiddleware", () => {
  it("passes every request through untouched in public mode, no key needed", async () => {
    const app = appWith(createAccessControlConfig("public"));
    const res = await request(app).get("/thing");
    expect(res.status).toBe(200);
  });

  it("rejects a request with no key in restricted mode", async () => {
    const app = appWith(createAccessControlConfig("restricted", ["real-key"]));
    const res = await request(app).get("/thing");
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong key in restricted mode", async () => {
    const app = appWith(createAccessControlConfig("restricted", ["real-key"]));
    const res = await request(app).get("/thing").set("x-indexer-api-key", "wrong-key");
    expect(res.status).toBe(401);
  });

  it("accepts a request with a valid key in restricted mode", async () => {
    const app = appWith(createAccessControlConfig("restricted", ["real-key"]));
    const res = await request(app).get("/thing").set("x-indexer-api-key", "real-key");
    expect(res.status).toBe(200);
  });
});

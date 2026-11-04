import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
describe("health", () => {
  it("GET /health", async () => {
    const r = await request(createApp()).get("/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
  });
});

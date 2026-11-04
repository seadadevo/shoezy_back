import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { corsOptions } from "../../src/config/cors";
import { notificationSocketOptions } from "../../src/modules/notifications/notifications.socket";

const configuredOrigins = [
  "http://localhost:3000",
  "https://shoozy-frontend.vercel.app",
  "https://www.shoozy.com",
];

describe("configured CORS allowlist", () => {
  it.each(configuredOrigins)("allows configured HTTP origin %s", async (origin) => {
    const response = await request(createApp()).get("/health").set("Origin", origin);
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects an unknown browser origin", async () => {
    const response = await request(createApp()).get("/health").set("Origin", "https://attacker.example");
    expect(response.status).toBe(500);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("preserves requests without an Origin header", async () => {
    const response = await request(createApp()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("uses the same CORS options for Socket.IO", () => {
    expect(notificationSocketOptions.cors).toBe(corsOptions);
  });
});

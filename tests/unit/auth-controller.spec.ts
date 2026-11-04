import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuthController } from "../../src/modules/auth/auth.controller";
import type { AuthService } from "../../src/modules/auth/auth.service";
import { errorHandler } from "../../src/common/middlewares/error-handler.middleware";
import { validate } from "../../src/common/middlewares/validate.middleware";
import { loginSchema } from "../../src/modules/auth/auth.validation";

describe("auth HTTP secret handling", () => {
  it("puts refresh only in an HttpOnly cookie and returns a safe login body", async () => {
    const service = {
      login: async () => ({
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "user@example.com",
          firstName: "Test",
          lastName: "User",
          provider: "EMAIL",
          emailVerifiedAt: new Date(),
        },
        accessToken: "safe-access-token",
        refreshToken: "raw-refresh-secret",
      }),
    } as unknown as AuthService;
    const controller = new AuthController(service);
    const app = express();
    app.use(express.json());
    app.post("/login", validate(loginSchema), controller.login);
    app.use(errorHandler);
    const response = await request(app).post("/login").send({
      email: "user@example.com",
      password: "a-very-strong-password",
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ accessToken: "safe-access-token" });
    expect(JSON.stringify(response.body)).not.toContain("raw-refresh-secret");
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
  });

  it("does not echo a missing or malformed refresh cookie", async () => {
    const service = {} as AuthService;
    const controller = new AuthController(service);
    const app = express();
    app.post("/refresh", controller.refresh);
    app.use(errorHandler);
    const response = await request(app).post("/refresh");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: "AUTH_REFRESH_INVALID", message: "Refresh token is required" },
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env";
import { passwordResetEmail } from "../../src/modules/auth/auth.mail";

const originalFrontend = env.FRONTEND_URL;
const originalExpiry = env.AUTH_RESET_TOKEN_EXPIRES_IN;

afterEach(() => {
  env.FRONTEND_URL = originalFrontend;
  env.AUTH_RESET_TOKEN_EXPIRES_IN = originalExpiry;
});

describe("password reset email", () => {
  it("uses the configured frontend origin, Shoezy branding, and expiry notice", () => {
    env.FRONTEND_URL = "https://shop.example.com";
    env.AUTH_RESET_TOKEN_EXPIRES_IN = "30m";
    const message = passwordResetEmail("customer@example.com", "secure-reset-token");
    expect(message.subject).toBe("Reset your Shoezy password");
    expect(message.text).toContain("https://shop.example.com/reset-password?token=secure-reset-token");
    expect(message.text).toContain("expires in 30 minutes");
    expect(message.text).toContain("only be used once");
    expect(message.html).toContain("SHOEZY");
    expect(message.html).toContain("Reset Password");
  });
});


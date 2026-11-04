import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://example.invalid/shoes",
  JWT_ACCESS_SECRET: "a-production-access-secret-that-is-long-enough",
  JWT_REFRESH_SECRET: "a-different-production-refresh-secret-long-enough",
  AUTH_COOKIE_SECURE: "true",
  AUTH_COOKIE_SAME_SITE: "lax",
  AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
  CORS_ORIGINS: "https://shop.example.com, https://www.example.com",
  FRONTEND_URL: "https://shop.example.com",
  SMTP_HOST: "smtp.example.com",
  MAIL_FROM: "shop@example.com",
  ORDER_NOTIFICATION_EMAIL: "orders@example.com",
};

describe("production environment fail-closed validation", () => {
  it("uses the Next.js development origin for local email links", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development", FRONTEND_URL: undefined }).FRONTEND_URL).toBe("http://localhost:3000");
  });

  it("accepts safe production configuration", () => {
    expect(parseEnv(base)).toMatchObject({ NODE_ENV: "production", AUTH_COOKIE_SECURE: true });
  });

  it.each([
    [{ AUTH_COOKIE_SECURE: "false" }, "AUTH_COOKIE_SECURE"],
    [{ FRONTEND_URL: "http://[::1]:5173" }, "FRONTEND_URL"],
    [{ AUTH_COOKIE_SAME_SITE: "none", AUTH_COOKIE_SECURE: "false" }, "AUTH_COOKIE_SECURE"],
  ])("rejects unsafe production setting %o", (override, path) => {
    const result = parseEnvSafe({ ...base, ...override });
    expect(result.paths).toContain(path);
  });

  it("requires mail transport essentials when production verification is enabled", () => {
    const result = parseEnvSafe({ ...base, AUTH_REQUIRE_EMAIL_VERIFICATION: "true", SMTP_HOST: "", MAIL_FROM: "" });
    expect(result.paths).toEqual(expect.arrayContaining(["SMTP_HOST", "MAIL_FROM"]));
  });

  it("parses and trims a comma-separated CORS allowlist", () => {
    expect(parseEnv({ ...base, CORS_ORIGINS: " http://localhost:3000, https://shoozy-frontend.vercel.app, ,https://www.shoozy.com " }).CORS_ORIGINS).toEqual([
      "http://localhost:3000",
      "https://shoozy-frontend.vercel.app",
      "https://www.shoozy.com",
    ]);
  });

  it("rejects an empty or invalid CORS allowlist", () => {
    expect(parseEnvSafe({ ...base, CORS_ORIGINS: " , " }).paths).toContain("CORS_ORIGINS");
    expect(parseEnvSafe({ ...base, CORS_ORIGINS: "*" }).paths).toContain("CORS_ORIGINS");
  });

  it("requires an admin order address in production", () => {
    expect(parseEnvSafe({ ...base, ORDER_NOTIFICATION_EMAIL: "" }).paths).toContain("ORDER_NOTIFICATION_EMAIL");
    expect(parseEnvSafe({ ...base, ORDER_NOTIFICATION_EMAIL: "invalid" }).paths).toContain("ORDER_NOTIFICATION_EMAIL");
  });

  it("requires SMTP credentials as a pair but permits an unauthenticated relay", () => {
    expect(parseEnv({ ...base, SMTP_HOST: "smtp.example.com", MAIL_FROM: "shop@example.com" })).toBeDefined();
    expect(parseEnvSafe({ ...base, SMTP_USER: "mailer" }).paths).toContain("SMTP_PASSWORD");
    expect(parseEnvSafe({ ...base, SMTP_PASSWORD: "secret" }).paths).toContain("SMTP_USER");
  });
});

function parseEnvSafe(input: Record<string, unknown>) {
  const result = parseEnvResult(input);
  return { paths: result.success ? [] : result.error.issues.map((issue) => String(issue.path[0])) };
}

function parseEnvResult(input: Record<string, unknown>) {
  try {
    return { success: true as const, data: parseEnv(input) };
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return { success: false as const, error: error as { issues: Array<{ path: PropertyKey[] }> } };
    }
    throw error;
  }
}

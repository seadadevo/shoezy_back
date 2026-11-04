import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  updateProfileSchema,
} from "../../src/modules/users/users.validation";

const request = (body: unknown) => ({ body, params: {}, query: {} });

describe("profile request validation", () => {
  it.each(["role", "roles", "permissions", "status", "provider", "email", "userId"])(
    "rejects %s mass assignment",
    (field) => {
      expect(updateProfileSchema.safeParse(request({ [field]: "injected" })).success).toBe(false);
    },
  );

  it("normalizes profile phones to the canonical Tunisian format", () => {
    const result = updateProfileSchema.parse(
      request({ firstName: "  Updated  ", phone: "  00216 21 111 111  " }),
    );
    expect(result.body).toEqual({ firstName: "Updated", phone: "+21621111111" });
  });

  it("enforces bcrypt's UTF-8 byte boundary", () => {
    expect(
      changePasswordSchema.safeParse(
        request({ currentPassword: "valid-password-123", newPassword: "é".repeat(37) }),
      ).success,
    ).toBe(false);
  });
});

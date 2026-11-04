import { describe, expect, it } from "vitest";
import {
  isValidTunisianPhone,
  normalizeTunisianPhone,
  tunisianPhoneEquivalentValues,
  tunisianPhoneSchema,
} from "../../src/common/validation/tunisian-phone";
import { registerSchema } from "../../src/modules/auth/auth.validation";

describe("Tunisian customer phone validation", () => {
  it.each(["20123456", "29123456", "40123456", "59123456", "99123456"])(
    "accepts allowed local number %s",
    (phone) => expect(isValidTunisianPhone(phone)).toBe(true),
  );

  it.each(["30123456", "60123456", "70123456", "80123456", "2012345", "201234567"])(
    "rejects invalid local number %s",
    (phone) => expect(tunisianPhoneSchema.safeParse(phone).success).toBe(false),
  );

  it.each(["20123456", "+21620123456", "21620123456", "0021620123456", "+216 20 123 456"])(
    "normalizes %s to the canonical stored value",
    (phone) => expect(normalizeTunisianPhone(phone)).toBe("+21620123456"),
  );

  it("builds the exact legacy-equivalent values used for unique user phones", () => {
    expect(tunisianPhoneEquivalentValues("+21620123456")).toEqual([
      "+21620123456",
      "20123456",
      "21620123456",
      "0021620123456",
    ]);
  });

  it("normalizes registration before persistence and therefore before unique lookup", () => {
    const parsed = registerSchema.parse({
      body: {
        email: "customer@example.com",
        password: "a-strong-password-value",
        firstName: "Test",
        lastName: "Customer",
        phone: "00216 20 123 456",
      },
      params: {},
      query: {},
    });
    expect(parsed.body.phone).toBe("+21620123456");
  });
});

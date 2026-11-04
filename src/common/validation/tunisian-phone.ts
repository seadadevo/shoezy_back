import { z } from "zod";

const TUNISIAN_LOCAL_PHONE = /^(?:2\d|4\d|5\d|9\d)\d{6}$/;
const COMMON_PHONE_SEPARATORS = /[\s().-]/g;

export function normalizeTunisianPhone(value: string): string | null {
  const compact = value.trim().replace(COMMON_PHONE_SEPARATORS, "");
  let local = compact;

  if (compact.startsWith("+216")) local = compact.slice(4);
  else if (compact.startsWith("00216")) local = compact.slice(5);
  else if (compact.startsWith("216")) local = compact.slice(3);

  return TUNISIAN_LOCAL_PHONE.test(local) ? `+216${local}` : null;
}

export function isValidTunisianPhone(value: string): boolean {
  return normalizeTunisianPhone(value) !== null;
}

export function tunisianPhoneEquivalentValues(value: string): string[] {
  const canonical = normalizeTunisianPhone(value);
  if (!canonical) return [];
  const local = canonical.slice(4);
  return [canonical, local, `216${local}`, `00216${local}`];
}

export const tunisianPhoneSchema = z.string().transform((value, context) => {
  const normalized = normalizeTunisianPhone(value);
  if (!normalized) {
    context.addIssue({
      code: "custom",
      message: "Enter a valid Tunisian mobile number",
    });
    return z.NEVER;
  }
  return normalized;
});

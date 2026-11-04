import type { Prisma, ShippingMethod } from "@prisma/client";

type AddressForZone = { countryCode: string; state: string | null; city: string; area: string | null };
type MethodForZone = Pick<ShippingMethod, "id" | "currency" | "basePriceMinor" | "estimatedMinDays" | "estimatedMaxDays" | "code" | "name">;
export const locationKey = (value: string | null | undefined) => value?.trim().toLocaleLowerCase("en-US") ?? "";

export type ResolvedShipping = {
  priceMinor: bigint;
  currency: string;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  zone: { code: string; name: string } | null;
};

function matchingAreas<T extends { cityKey: string; areaKey: string }>(candidates: T[], cityKey: string, areaKey: string): T[] {
  return candidates
    .filter((candidate) => (!candidate.cityKey || candidate.cityKey === cityKey) && (!candidate.areaKey || candidate.areaKey === areaKey))
    .sort((left, right) => Number(Boolean(right.areaKey)) * 2 + Number(Boolean(right.cityKey)) - Number(Boolean(left.areaKey)) * 2 - Number(Boolean(left.cityKey)));
}

export async function resolveShippingRate(transaction: Prisma.TransactionClient, address: AddressForZone, method: MethodForZone): Promise<ResolvedShipping | "NOT_AVAILABLE" | "CURRENCY_MISMATCH"> {
  const countryCode = address.countryCode.trim().toUpperCase();
  const stateKey = locationKey(address.state);
  const cityKey = locationKey(address.city);
  const areaKey = locationKey(address.area);
  const configuredZones = await transaction.shippingZone.count();
  if (configuredZones === 0) return { priceMinor: method.basePriceMinor, currency: method.currency, estimatedMinDays: method.estimatedMinDays, estimatedMaxDays: method.estimatedMaxDays, zone: null };
  if (!stateKey || countryCode !== "TN") return "NOT_AVAILABLE";
  const candidates = await transaction.shippingZoneArea.findMany({
    where: { countryCode, stateKey, cityKey: { in: ["", cityKey] }, areaKey: { in: ["", areaKey] }, zone: { isActive: true, rates: { some: { shippingMethodId: method.id, isActive: true } } } },
    select: { cityKey: true, areaKey: true, zone: { select: { code: true, name: true, rates: { where: { shippingMethodId: method.id, isActive: true }, select: { priceMinor: true, currency: true, estimatedMinDays: true, estimatedMaxDays: true } } } } },
  });
  const matching = matchingAreas(candidates, cityKey, areaKey);
  const selected = matching[0];
  if (!selected) return "NOT_AVAILABLE";
  const rate = selected.zone.rates[0];
  if (!rate) return "NOT_AVAILABLE";
  if (rate.currency !== method.currency) return "CURRENCY_MISMATCH";
  return { priceMinor: rate.priceMinor, currency: rate.currency, estimatedMinDays: rate.estimatedMinDays, estimatedMaxDays: rate.estimatedMaxDays, zone: { code: selected.zone.code, name: selected.zone.name } };
}

/** Resolve a preview's active methods in one zone-area read using checkout's matching rules. */
export async function resolveShippingRates(transaction: Prisma.TransactionClient, address: AddressForZone, methods: MethodForZone[]): Promise<Map<string, ResolvedShipping>> {
  const resolved = new Map<string, ResolvedShipping>();
  if (methods.length === 0) return resolved;
  const configuredZones = await transaction.shippingZone.count();
  if (configuredZones === 0) {
    for (const method of methods) resolved.set(method.id, {
      priceMinor: method.basePriceMinor, currency: method.currency,
      estimatedMinDays: method.estimatedMinDays, estimatedMaxDays: method.estimatedMaxDays, zone: null,
    });
    return resolved;
  }
  const countryCode = address.countryCode.trim().toUpperCase();
  const stateKey = locationKey(address.state);
  if (!stateKey || countryCode !== "TN") return resolved;
  const cityKey = locationKey(address.city);
  const areaKey = locationKey(address.area);
  const methodIds = methods.map((method) => method.id);
  const candidates = await transaction.shippingZoneArea.findMany({
    where: {
      countryCode, stateKey, cityKey: { in: ["", cityKey] }, areaKey: { in: ["", areaKey] },
      zone: { isActive: true, rates: { some: { shippingMethodId: { in: methodIds }, isActive: true } } },
    },
    select: {
      cityKey: true, areaKey: true,
      zone: { select: { code: true, name: true, rates: {
        where: { shippingMethodId: { in: methodIds }, isActive: true },
        select: { shippingMethodId: true, priceMinor: true, currency: true, estimatedMinDays: true, estimatedMaxDays: true },
      } } },
    },
  });
  for (const method of methods) {
    const match = matchingAreas(candidates.filter((candidate) => candidate.zone.rates.some((rate) => rate.shippingMethodId === method.id)), cityKey, areaKey)[0];
    const rate = match?.zone.rates.find((item) => item.shippingMethodId === method.id);
    if (!rate || rate.currency !== method.currency) continue;
    resolved.set(method.id, {
      priceMinor: rate.priceMinor, currency: rate.currency,
      estimatedMinDays: rate.estimatedMinDays, estimatedMaxDays: rate.estimatedMaxDays,
      zone: { code: match.zone.code, name: match.zone.name },
    });
  }
  return resolved;
}

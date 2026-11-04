export type RelatedSignals = {
  categoryIds: ReadonlySet<string>;
  collectionIds: ReadonlySet<string>;
  brandId: string;
  gender: string | null;
  basePrice: number;
};

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let matches = 0;
  for (const id of left) if (right.has(id)) matches += 1;
  return matches;
}

/** Category +50 each, collection +35 each, brand +20, gender +10, price up to +15 within 25%. */
export function relatedScore(source: RelatedSignals, candidate: RelatedSignals): number {
  const category = overlap(source.categoryIds, candidate.categoryIds) * 50;
  const collection = overlap(source.collectionIds, candidate.collectionIds) * 35;
  const brand = source.brandId === candidate.brandId ? 20 : 0;
  const gender = source.gender && candidate.gender && source.gender.toLowerCase() === candidate.gender.toLowerCase() ? 10 : 0;
  const relativeDifference = source.basePrice === 0
    ? candidate.basePrice === 0 ? 0 : Infinity
    : Math.abs(candidate.basePrice - source.basePrice) / source.basePrice;
  const price = relativeDifference <= 0.25 ? Math.round(15 * (1 - relativeDifference / 0.25)) : 0;
  return category + collection + brand + gender + price;
}

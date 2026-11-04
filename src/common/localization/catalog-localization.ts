export const CATALOG_LOCALES = ["ar", "en"] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];

export function catalogLocale(acceptLanguage: string | undefined): CatalogLocale {
  const requested = acceptLanguage?.split(",")[0]?.trim().toLowerCase();
  return requested?.startsWith("ar") ? "ar" : "en";
}

type TranslationRow = { locale: string } & Record<string, unknown>;

export function translationsByLocale<T extends TranslationRow>(translations: readonly T[] | undefined) {
  return Object.fromEntries((translations ?? []).map(({ locale, ...fields }) => [locale, fields]));
}

export function localizedField<T>(translations: readonly TranslationRow[] | undefined, locale: CatalogLocale, field: string, legacy: T): T {
  const values = translations ?? [];
  const requested = values.find((translation) => translation.locale === locale)?.[field];
  if (requested !== undefined && requested !== null && requested !== "") return requested as T;
  const english = values.find((translation) => translation.locale === "en")?.[field];
  if (english !== undefined && english !== null && english !== "") return english as T;
  return legacy;
}

export type TranslationMap<T> = Partial<Record<CatalogLocale, T>>;

export async function upsertTranslations<T extends Record<string, unknown>>(
  translations: TranslationMap<T> | undefined,
  upsert: (locale: CatalogLocale, fields: T) => Promise<unknown>,
) {
  if (!translations) return;
  for (const locale of CATALOG_LOCALES) {
    const fields = translations[locale];
    if (fields) await upsert(locale, fields);
  }
}

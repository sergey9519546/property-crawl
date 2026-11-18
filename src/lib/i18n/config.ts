export const LOCALES = ["en", "hy", "ru"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "pp_locale";
export const LOCALE_HEADER = "x-pp-locale";

export type LocaleMeta = {
  code: Locale;
  shortLabel: string;
  nativeLabel: string;
  englishLabel: string;
  intlLocale: string;
  ogLocale: string;
};

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: {
    code: "en",
    shortLabel: "EN",
    nativeLabel: "English",
    englishLabel: "English",
    intlLocale: "en-US",
    ogLocale: "en_US",
  },
  hy: {
    code: "hy",
    shortLabel: "ՀՅ",
    nativeLabel: "Հայերեն",
    englishLabel: "Armenian",
    intlLocale: "hy-AM",
    ogLocale: "hy_AM",
  },
  ru: {
    code: "ru",
    shortLabel: "РУ",
    nativeLabel: "Русский",
    englishLabel: "Russian",
    intlLocale: "ru-RU",
    ogLocale: "ru_RU",
  },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value || typeof value !== "string") return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === "hy" || primary === "arm" || primary === "am") return "hy";
  if (primary === "ru" || primary === "rus") return "ru";
  if (primary === "en" || primary === "eng") return "en";
  return null;
}

export function negotiateLocaleFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header || typeof header !== "string") return DEFAULT_LOCALE;
  const candidates = header
    .split(",")
    .map((part) => {
      const [tagPart, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const qVal = qParam ? Number(qParam.trim().slice(2)) : 1;
      return {
        locale: normalizeLocale(tagPart),
        q: Number.isFinite(qVal) ? qVal : 0,
      };
    })
    .filter((entry): entry is { locale: Locale; q: number } => entry.locale !== null && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  return candidates[0]?.locale ?? DEFAULT_LOCALE;
}

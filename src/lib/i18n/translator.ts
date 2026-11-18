import { LOCALE_META, type Locale } from "./config";

export type PluralForms = {
  one: string;
  few?: string;
  many?: string;
  other: string;
};

const HY_MONTHS_SHORT = [
  "հնվ", "փտվ", "մրտ", "ապր", "մյս", "հնս",
  "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ",
] as const;

const HY_MONTHS_LONG = [
  "հունվար", "փետրվար", "մարտ", "ապրիլ", "մայիս", "հունիս",
  "հուլիս", "օգոստոս", "սեպտեմբեր", "հոկտեմբեր", "նոյեմբեր", "դեկտեմբեր",
] as const;

function formatHyGroupedNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const raw = String(abs);
  if (raw.includes("e") || raw.includes("E")) {
    return value.toLocaleString("en-US");
  }
  const [intPart, decPart] = raw.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return decPart !== undefined ? `${sign}${grouped},${decPart}` : `${sign}${grouped}`;
}

const pluralRuleCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale: Locale): Intl.PluralRules {
  let rules = pluralRuleCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRuleCache.set(locale, rules);
  }
  return rules;
}

export function interpolate(
  template: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const val = params[key];
    return val === undefined || val === null ? match : String(val);
  });
}

export function selectPlural(
  locale: Locale,
  count: number,
  forms: PluralForms,
  params?: Record<string, string | number | null | undefined>,
): string {
  const category = getPluralRules(locale).select(count);
  const template =
    (category === "one" && forms.one) ||
    (category === "few" && forms.few) ||
    (category === "many" && forms.many) ||
    forms.other;
  return interpolate(template, { ...params, count });
}

export function formatLocaleNumber(locale: Locale, value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (locale === "hy") return formatHyGroupedNumber(value);
  return value.toLocaleString(LOCALE_META[locale].intlLocale);
}

export function formatUsd(
  locale: Locale,
  value: number,
  options?: { maximumFractionDigits?: number },
): string {
  if (!Number.isFinite(value)) return "—";
  const maxFrac = options?.maximumFractionDigits ?? 0;
  const rounded = maxFrac === 0 ? Math.round(value) : Number(value.toFixed(maxFrac));
  if (locale === "hy") return `$${formatHyGroupedNumber(rounded)}`;
  return new Intl.NumberFormat(LOCALE_META[locale].intlLocale, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: maxFrac,
  }).format(rounded);
}

export function formatLocaleDate(
  locale: Locale,
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeZone: "UTC" },
): string {
  const ts = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return typeof value === "string" ? value : "—";
  if (locale === "hy") {
    const d = new Date(ts);
    const months = options.month === "long" ? HY_MONTHS_LONG : HY_MONTHS_SHORT;
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${d.getUTCFullYear()} թ.`;
  }
  return new Intl.DateTimeFormat(LOCALE_META[locale].intlLocale, options).format(ts);
}

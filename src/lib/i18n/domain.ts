import { listingCatch, type ListingCatch } from "@/lib/listing-catch";
import { LOCALE_META, type Locale } from "./config";
import type { Messages } from "./messages";
import { formatLocaleDate, formatLocaleNumber } from "./translator";

function finiteNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() && !/^(?:—|unknown|n\/a)$/i.test(value.trim())
    ? value.trim()
    : null;
}

const formatUsdRaw = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function localizePropType(raw: unknown, m: Messages, locale: Locale): string | null {
  const txt = cleanText(raw);
  if (!txt) return null;
  if (locale === "en") return txt;
  const map = m.enumLabels.propType as Record<string, string>;
  return map[txt.toLowerCase()] ?? txt;
}

export function localizeOccupancy(raw: unknown, m: Messages, locale: Locale): string | null {
  const txt = cleanText(raw);
  if (!txt) return null;
  if (locale === "en") return txt;
  const map = m.enumLabels.occupancy as Record<string, string>;
  return map[txt.toLowerCase()] ?? txt;
}

export function localizeSaleKind(kind: string, m: Messages, locale: Locale): string {
  if (locale === "en") return kind;
  const map = m.enumLabels.saleTitleKind as Record<string, string>;
  return map[kind] ?? kind;
}

export function localizeDisplayDate(value: unknown, locale: Locale, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return formatLocaleDate(locale, ts, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

export function localizeNumberText(value: number | null | undefined, locale: Locale, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return formatLocaleNumber(locale, value);
}

export function localizeRedemption(locale: Locale, days: number, englishFallback: string): string {
  if (locale === "en" || !Number.isFinite(days)) return englishFallback;
  const rounded = Math.round(days);
  if (rounded <= 0) {
    return locale === "hy" ? "Անմիջական (0 օր)" : "Нет (0 дн.)";
  }
  return locale === "hy" ? `${rounded} օր հետգնում` : `Выкуп ${rounded} дн.`;
}

type CatchInput = Parameters<typeof listingCatch>[0];

export function localizedListingCatch(
  listing: CatchInput,
  titleWarnings: string[] = [],
  locale: Locale = "en",
): ListingCatch {
  if (locale === "en") {
    return listingCatch(listing, titleWarnings);
  }

  const flags: string[] = [];
  const notes: string[] = [];
  const bid = finiteNum(listing.openingBid);
  const low = finiteNum(listing.estLow);
  const high = finiteNum(listing.estHigh);
  const judgment = finiteNum(listing.judgment);
  const occupancy = cleanText(listing.occupancy);
  const redemption = finiteNum(listing.redemptionDays);
  const lien = cleanText(listing.seniorLienRisk);
  const deposit = cleanText(listing.deposit);
  const fresh = listing.sourceFreshness;
  const redemptionFlagged = (redemption !== null && redemption > 0) || !!cleanText(listing.redemptionWarning);
  const strippedWarnings = titleWarnings
    .filter((w) => !(redemptionFlagged && /^STATUTORY REDEMPTION/.test(w)))
    .slice(0, 2)
    .map((w) => w.replace(/^[A-Z0-9][A-Z0-9 '’-]*:\s*/, ""));

  if (locale === "hy") {
    if (bid !== null && bid > 0 && low !== null && high !== null && high >= low && low > 0) {
      const pct = Math.round((bid / ((low + high) / 2)) * 100);
      notes.push(`Մեկնարկում է ${formatUsdRaw(bid)}-ից՝ պահված ${formatUsdRaw(low)}–${formatUsdRaw(high)} միջակայքի ${pct}%-ը։`);
    } else if (bid !== null && bid > 0) {
      flags.push(`Մեկնարկում է ${formatUsdRaw(bid)}-ից, սակայն գնահատված արժեքի միջակայք չկա, ուստի միայն այս գրառումից հնարավոր չէ դատել զեղչի մասին։`);
    } else if (judgment !== null && judgment > 0) {
      flags.push(`Աճուրդից առաջ մեկնարկային գին չի հրապարակվել։ Դատական պահանջի գումարը ${formatUsdRaw(judgment)} է․ մեկնարկային կամ պահուստային գինը հայտարարվում է վաճառքի օրը։`);
    } else {
      flags.push("Մեկնարկային գինը հրապարակված չէ, ուստի գինը անհայտ է մինչև աճուրդը։");
    }

    if (!occupancy) {
      flags.push("Բնակեցվածությունը հրապարակված չէ․ ենթադրեք, որ ներքին զննում չկա և հնարավոր է վտարման ծախս։");
    } else if (/occupied/i.test(occupancy) && !/unoccupied/i.test(occupancy)) {
      flags.push(`Նշված է որպես բնակեցված (${occupancy})․ ներքին մուտք հավանաբար չի լինի, և հնարավոր են վտարման ծախսեր։`);
    } else {
      notes.push(`Հրապարակված կարգավիճակ՝ ${occupancy}։`);
    }

    if (redemption !== null && redemption > 0) {
      flags.push(`${listing.state || "Նահանգի"} հետգնման կանոն․ մինչև ${Math.round(redemption)} օր։ Նախկին սեփականատերը կարող է հետ գնել գույքը ձեր հաղթանակից հետո։`);
    } else if (cleanText(listing.redemptionWarning)) {
      flags.push(cleanText(listing.redemptionWarning)!);
    }

    if (lien && !/^(low|none)$/i.test(lien)) {
      flags.push(`Ավագ գրավի ազդանշան՝ ${lien}․ այս վաճառքից առաջ գրանցված գրավները կարող են պահպանվել գույքի վրա։`);
    }
    flags.push(...strippedWarnings);

    if (deposit) notes.push(`Կանխավճար՝ ${deposit}։`);
    else flags.push("Կանխավճարի պայմանները հրապարակված չեն։ Շատ աճուրդներ պահանջում են վավերացված միջոցներ վաճառքի օրը։");

    if (!cleanText(listing.saleDate)) flags.push("Վաճառքի ամսաթիվը հրապարակված չէ։");
    if (fresh && fresh.status === "stale" && fresh.ageHours !== null) {
      flags.push(`Աղբյուրը վերջին անգամ ստուգվել է ${Math.round(fresh.ageHours / 24)} օր առաջ։ Հաստատեք, որ վաճառքը դեռ ակտիվ է։`);
    }
    return { flags, notes };
  }

  // Russian (ru)
  if (bid !== null && bid > 0 && low !== null && high !== null && high >= low && low > 0) {
    const pct = Math.round((bid / ((low + high) / 2)) * 100);
    notes.push(`Старт с ${formatUsdRaw(bid)} — ${pct}% от опубликованного диапазона стоимости ${formatUsdRaw(low)}–${formatUsdRaw(high)}.`);
  } else if (bid !== null && bid > 0) {
    flags.push(`Старт с ${formatUsdRaw(bid)}, но рыночный диапазон не опубликован — по самой карточке нельзя оценить дисконт.`);
  } else if (judgment !== null && judgment > 0) {
    flags.push(`Стартовая ставка до торгов не опубликована (типично для торгов шерифа). Судебный долг: ${formatUsdRaw(judgment)}; резервная цена объявляется утром в день торгов.`);
  } else {
    flags.push("Стартовая сумма не опубликована — цена станет известна только на торгах.");
  }

  if (!occupancy) {
    flags.push("Статус жильцов не указан: исходите из отсутствия внутреннего осмотра и возможного выселения.");
  } else if (/occupied/i.test(occupancy) && !/unoccupied/i.test(occupancy)) {
    flags.push(`Заявлено проживание (${occupancy}): доступ внутрь маловероятен, возможны расходы на выселение.`);
  } else {
    notes.push(`Статус заселённости по источнику: ${occupancy}.`);
  }

  if (redemption !== null && redemption > 0) {
    flags.push(`Период выкупа (${listing.state || "штат"}): до ${Math.round(redemption)} дн. Прежний владелец может выкупить объект после вашей победы на торгах.`);
  } else if (cleanText(listing.redemptionWarning)) {
    flags.push(cleanText(listing.redemptionWarning)!);
  }

  if (lien && !/^(low|none)$/i.test(lien)) {
    flags.push(`Сигнал старшего залога (${lien}): обязательства с более высоким приоритетом могут сохраниться за покупателем.`);
  }
  flags.push(...strippedWarnings);

  if (deposit) notes.push(`Задаток: ${deposit}.`);
  else flags.push("Условия задатка не опубликованы. Обычно требуются сертифицированные средства в день торгов.");

  if (!cleanText(listing.saleDate)) flags.push("Дата торгов не опубликована.");
  if (fresh && fresh.status === "stale" && fresh.ageHours !== null) {
    flags.push(`Источник последний раз проверялся ${Math.round(fresh.ageHours / 24)} дн. назад. Уточните актуальность торгов.`);
  }
  return { flags, notes };
}

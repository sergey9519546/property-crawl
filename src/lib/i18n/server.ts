import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isLocale,
  negotiateLocaleFromAcceptLanguage,
  normalizeLocale,
  type Locale,
} from "./config";

export async function getRequestLocale(): Promise<Locale> {
  try {
    const hdrs = await headers();
    const fromHeader = hdrs.get(LOCALE_HEADER);
    if (isLocale(fromHeader)) return fromHeader;

    const cookieStore = await cookies();
    const fromCookie = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
    if (fromCookie) return fromCookie;

    return negotiateLocaleFromAcceptLanguage(hdrs.get("accept-language"));
  } catch {
    return DEFAULT_LOCALE;
  }
}

"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_META,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";
import { getMessages, type Messages } from "@/lib/i18n/messages";
import { interpolate, selectPlural, type PluralForms } from "@/lib/i18n/translator";

type LocaleContextValue = {
  locale: Locale;
  intlLocale: string;
  messages: Messages;
  setLocale: (next: Locale) => void;
  format: (template: string, params?: Record<string, string | number | null | undefined>) => string;
  plural: (count: number, forms: PluralForms, params?: Record<string, string | number | null | undefined>) => string;
};

const defaultContext: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  intlLocale: LOCALE_META[DEFAULT_LOCALE].intlLocale,
  messages: getMessages(DEFAULT_LOCALE),
  setLocale: () => {},
  format: interpolate,
  plural: (count, forms, params) => selectPlural(DEFAULT_LOCALE, count, forms, params),
};

const LocaleContext = React.createContext<LocaleContextValue>(defaultContext);

export function LocaleProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [locale, setLocaleState] = React.useState<Locale>(
    isLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE,
  );

  React.useEffect(() => {
    if (isLocale(initialLocale) && initialLocale !== locale) {
      setLocaleState(initialLocale);
    }
  }, [initialLocale, locale]);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = React.useCallback(
    (next: Locale) => {
      if (!isLocale(next)) return;
      try {
        document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
        window.localStorage.setItem(LOCALE_COOKIE, next);
      } catch {
        // Storage unavailable
      }
      document.documentElement.lang = next;
      setLocaleState(next);

      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (params.has("lang")) {
          params.set("lang", next);
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }
      }
      router.refresh();
    },
    [pathname, router],
  );

  const value = React.useMemo<LocaleContextValue>(
    () => ({
      locale,
      intlLocale: LOCALE_META[locale].intlLocale,
      messages: getMessages(locale),
      setLocale,
      format: interpolate,
      plural: (count, forms, params) => selectPlural(locale, count, forms, params),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return React.useContext(LocaleContext);
}

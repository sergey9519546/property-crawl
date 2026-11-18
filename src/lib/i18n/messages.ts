import { DEFAULT_LOCALE, type Locale } from "./config";
import { enMessages, type Messages } from "./messages/en";
import { hyMessages } from "./messages/hy";
import { ruMessages } from "./messages/ru";

export type { Messages } from "./messages/en";

export const MESSAGES_BY_LOCALE: Record<Locale, Messages> = {
  en: enMessages,
  hy: hyMessages,
  ru: ruMessages,
};

export function getMessages(locale: Locale = DEFAULT_LOCALE): Messages {
  return MESSAGES_BY_LOCALE[locale] ?? enMessages;
}

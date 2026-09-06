export type AddressRecord = {
  id: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

function normalizeAddressPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Produces a deliberately strict display-only address key. This is not a
 * canonical property identity: it never expands street abbreviations, removes
 * unit designators, or applies fuzzy matching.
 */
export function normalizedFullAddressKey(record: AddressRecord) {
  const address = typeof record.address === "string" ? normalizeAddressPart(record.address) : "";
  const city = typeof record.city === "string" ? normalizeAddressPart(record.city) : "";
  const state = typeof record.state === "string" ? normalizeAddressPart(record.state) : "";
  const zip = typeof record.zip === "string" ? record.zip.trim().toUpperCase() : "";

  if (address.length < 8 || city.length < 2 || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return null;
  }

  return [address, city, state, zip].join(" | ");
}

/**
 * Counts source-observed records sharing the same complete published address.
 * It intentionally leaves every record in the feed; callers use the returned
 * count only to make separately published evidence visible on each card.
 */
export function sourceRecordCountsAtAddress<T extends AddressRecord>(records: readonly T[], isObservedSourceRecord: (record: T) => boolean) {
  const groups = new Map<string, T[]>();

  for (const record of records) {
    if (!isObservedSourceRecord(record)) continue;
    const key = normalizedFullAddressKey(record);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const counts = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const record of group) counts.set(record.id, group.length);
  }
  return counts;
}

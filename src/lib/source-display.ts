/**
 * Converts internal source names to the neutral customer-facing label.
 * Keep this at UI and generated-document boundaries: source keys, URLs, and
 * provenance stay intact for collection and evidentiary traceability.
 */
export function sourceDisplayText(value: string): string {
  return value
    .replace(/(?:www\.)?servicelinkauction\.com/gi, "official publisher host")
    .replace(/servicelink(?:[\s_-]*auction)?/gi, "Public Auction Network");
}

import { permanentRedirect } from "next/navigation";
import { countyToSlug } from "@/lib/county-seo";

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// One canonical county page lives under /states; this path only redirects.
export default async function SheriffSalesRedirect({ params }: { params: Promise<{ state: string; county: string }> }) {
  const { state, county: rawCounty } = await params;
  const county = decodeParam(rawCounty);
  const slug = countyToSlug(county);
  permanentRedirect(`/states/${encodeURIComponent(state.toUpperCase())}/${slug || encodeURIComponent(county)}`);
}

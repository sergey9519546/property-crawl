import { permanentRedirect } from "next/navigation";

// One canonical county page lives under /states; this path only redirects.
export default async function SheriffSalesRedirect({ params }: { params: Promise<{ state: string; county: string }> }) {
  const { state, county } = await params;
  permanentRedirect(`/states/${encodeURIComponent(state.toUpperCase())}/${encodeURIComponent(county)}`);
}

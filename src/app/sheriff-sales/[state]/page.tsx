import { permanentRedirect } from "next/navigation";

// One canonical state page lives under /states; this path permanently redirects.
export default async function SheriffSalesStateRedirect({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  permanentRedirect(`/states/${encodeURIComponent(state.toUpperCase())}`);
}

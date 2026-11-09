import { permanentRedirect } from "next/navigation";
import { countyToSlug } from "@/lib/county-seo";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ state: string; county: string }>;
};

export default async function ForeclosureCountyPage({ params }: Props) {
  const { state, county } = await params;
  const cleanState = /^[A-Za-z]{2}$/.test(state || "") ? state.toUpperCase() : state;
  const cleanCounty = countyToSlug(county);
  permanentRedirect(`/states/${cleanState}/${cleanCounty}`);
}

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ state: string }>;
};

export default async function ForeclosureStatePage({ params }: Props) {
  const { state } = await params;
  const cleanState = /^[A-Za-z]{2}$/.test(state || "") ? state.toUpperCase() : state;
  permanentRedirect(`/states/${cleanState}`);
}

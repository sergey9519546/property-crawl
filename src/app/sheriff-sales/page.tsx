import { permanentRedirect } from "next/navigation";

// Canonical state index lives under /states; this path permanently redirects.
export default function SheriffSalesIndexRedirect() {
  permanentRedirect("/states");
}

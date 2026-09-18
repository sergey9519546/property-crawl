import { serializeJsonLd } from "@/lib/json-ld";

export function SeoSchema() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://perfectproperty.ai/#organization",
        "name": "PerfectProperty",
        "url": "https://perfectproperty.ai",
        "logo": "https://perfectproperty.ai/logo.svg",
        "description": "Evidence-first research workspace for distressed and government-sold property. Source observations, seed inventory, and optional AI notice parsing — not a guaranteed national listing feed."
      },
      {
        "@type": "WebSite",
        "@id": "https://perfectproperty.ai/#website",
        "url": "https://perfectproperty.ai",
        "name": "PerfectProperty",
        "publisher": { "@id": "https://perfectproperty.ai/#organization" }
      }
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
    />
  );
}

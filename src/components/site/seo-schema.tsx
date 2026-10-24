import { serializeJsonLd } from "@/lib/json-ld";

export function SeoSchema({ nonce }: { nonce?: string | null }) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://perfectproperty.ai/#organization",
        "name": "PerfectProperty",
        "url": "https://perfectproperty.ai",
        "logo": "https://perfectproperty.ai/logo.svg",
        "description": "Find sheriff sales, foreclosures, tax sales and government-sold homes in one place, with the risks spelled out."
      },
      {
        "@type": "WebSite",
        "@id": "https://perfectproperty.ai/#website",
        "url": "https://perfectproperty.ai",
        "name": "PerfectProperty",
        "description": "Find sheriff sales, foreclosures, tax sales and government-sold homes in one place, with the risks spelled out.",
        "publisher": { "@id": "https://perfectproperty.ai/#organization" }
      }
    ]
  };

  return (
    <script
      type="application/ld+json"
      nonce={nonce || undefined}
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
    />
  );
}

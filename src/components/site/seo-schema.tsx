import { serializeJsonLd } from "@/lib/json-ld";
import { getCanonicalOrigin } from "@/lib/app-origin";

export function SeoSchema({ nonce, locale = "en" }: { nonce?: string | null; locale?: string }) {
  const baseUrl = getCanonicalOrigin();
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${baseUrl}/#organization`,
        "name": "PerfectProperty",
        "url": baseUrl,
        "logo": `${baseUrl}/logo.svg`,
        "description": "Find sheriff sales, foreclosures, tax sales and government-sold homes in one place, with the risks spelled out."
      },
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        "url": baseUrl,
        "name": "PerfectProperty",
        "inLanguage": locale,
        "description": "Find sheriff sales, foreclosures, tax sales and government-sold homes in one place, with the risks spelled out.",
        "publisher": { "@id": `${baseUrl}/#organization` },
        "potentialAction": {
          "@type": "SearchAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": `${baseUrl}/listings?q={search_term_string}`
          },
          "query-input": "required name=search_term_string"
        }
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

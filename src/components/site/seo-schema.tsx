import { serializeJsonLd } from "@/lib/json-ld";

export function SeoSchema({ nonce }: { nonce?: string | null }) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || "https://property-crawl.onrender.com";
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

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
        "description": "Zillow for distressed & government-sold property. An AI that reads the fine print on every foreclosure, sheriff sale, and seizure."
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

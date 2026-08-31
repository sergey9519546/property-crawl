import { LISTINGS } from "@/data/listings";

export function SeoSchema() {
  const schemaListings = LISTINGS.slice(0, 10).map((l) => ({
    "@type": "RealEstateListing",
    "name": `Distressed Property: ${l.address}, ${l.city}, ${l.state}`,
    "description": `Judicial foreclosure auction. Opening bid $${l.openingBid.toLocaleString()} vs estimated value band $${l.estLow.toLocaleString()} - $${l.estHigh.toLocaleString()}. Calculated Deal Score: ${l.dealScore}/100.`,
    "url": `https://perfectproperty.ai/property/${l.id}`,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": l.address,
      "addressLocality": l.city,
      "addressRegion": l.state,
      "postalCode": l.zip,
      "addressCountry": "US"
    },
    "offers": {
      "@type": "AggregateOffer",
      "priceCurrency": "USD",
      "lowPrice": l.openingBid,
      "highPrice": l.estHigh,
      "offerCount": 1
    }
  }));

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
      },
      ...schemaListings
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}

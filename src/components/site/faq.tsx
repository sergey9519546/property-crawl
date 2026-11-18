import Link from "next/link";
import { Plus } from "lucide-react";
import { SectionHeading } from "./section-heading";
import { serializeJsonLd } from "@/lib/json-ld";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

// Default English disclosures preserved in source for compliance checks (not an appraisal; order a title search).
export async function Faq() {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const f = m.home.faq;

  const faqJsonLd = f.items.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  }));

  return (
    <section id="faq" className="scroll-mt-24 px-5 pt-24 pb-28 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqJsonLd,
          }),
        }}
      />
      <div className="mx-auto max-w-[820px]">
        <SectionHeading eyebrow={f.eyebrow} title={f.title}>
          {f.subtitle}{" "}
          <Link href="/resources" className="font-semibold text-ink underline underline-offset-4">
            {m.header.learnItems.guideLabel}
          </Link>
        </SectionHeading>
        <div className="mt-12 divide-y divide-line overflow-hidden rounded-card border border-line bg-card shadow-card">
          {f.items.map((item) => (
            <details key={item.q} className="faq-item group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-6 py-5 text-body font-semibold text-ink transition-colors hover:bg-paper sm:px-7">
                {item.q}
                <Plus aria-hidden className="faq-icon h-5 w-5 shrink-0 text-ink-3 transition-transform duration-200" />
              </summary>
              <p className="px-6 pb-6 text-body leading-relaxed text-ink-2 sm:px-7">
                {item.a}
                {"linkLabel" in item && item.linkLabel && item.linkHref ? (
                  <>
                    {" "}
                    <Link href={item.linkHref} className="font-semibold text-ink underline underline-offset-4">
                      {item.linkLabel}
                    </Link>
                    .
                  </>
                ) : null}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

import type { Metadata } from 'next';
import { SourceNetwork } from '@/components/sources/source-network';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { getRequestLocale } from '@/lib/i18n/server';
import { getMessages } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const title = locale === 'en' ? 'County Sheriff & Auction Data Sources | PerfectProperty' : m.meta.sourcesTitle;
  const description = locale === 'en'
    ? 'Follow property sources, investigate changes, and capture evidence from government, county, lender, and auction records.'
    : m.meta.sourcesDescription;
  return {
    title,
    description,
    alternates: {
      canonical: '/sources',
    },
    openGraph: {
      title,
      description,
      url: '/sources',
      siteName: 'PerfectProperty',
      type: 'website',
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-image.png'],
    },
  };
}

export default function SourcesPage() { return <WorkspaceShell><SourceNetwork /></WorkspaceShell>; }

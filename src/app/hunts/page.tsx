import type { Metadata } from 'next';
import { SavedHunts } from '@/components/hunts/saved-hunts';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { getRequestLocale } from '@/lib/i18n/server';
import { getMessages } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const title = locale === 'en' ? 'Auction Alerts & Saved Hunts | PerfectProperty' : m.meta.huntsTitle;
  const description = locale === 'en'
    ? 'Save a property search, explain each match, and compare source evidence over time.'
    : m.meta.huntsDescription;
  return {
    title,
    description,
    alternates: {
      canonical: '/hunts',
    },
    openGraph: {
      title,
      description,
      url: '/hunts',
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

export default function HuntsPage() { return <WorkspaceShell><SavedHunts /></WorkspaceShell>; }

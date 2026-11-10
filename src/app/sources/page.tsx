import type { Metadata } from 'next';
import { SourceNetwork } from '@/components/sources/source-network';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export const metadata: Metadata = {
  title: 'County Sheriff & Auction Data Sources | PerfectProperty',
  description: 'Follow property sources, investigate changes, and capture evidence from government, county, lender, and auction records.',
  alternates: {
    canonical: '/sources',
  },
  openGraph: {
    title: 'County Sheriff & Auction Data Sources | PerfectProperty',
    description: 'Follow property sources, investigate changes, and capture evidence from government, county, lender, and auction records.',
    url: '/sources',
    siteName: 'PerfectProperty',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'County Sheriff & Auction Data Sources | PerfectProperty',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'County Sheriff & Auction Data Sources | PerfectProperty',
    description: 'Follow property sources, investigate changes, and capture evidence from government, county, lender, and auction records.',
    images: ['/og-image.png'],
  },
};

export default function SourcesPage() { return <WorkspaceShell><SourceNetwork /></WorkspaceShell>; }

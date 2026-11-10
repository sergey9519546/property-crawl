import type { Metadata } from 'next';
import { SavedHunts } from '@/components/hunts/saved-hunts';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export const metadata: Metadata = {
  title: 'Auction Alerts & Saved Hunts | PerfectProperty',
  description: 'Save a property search, explain each match, and compare source evidence over time.',
  alternates: {
    canonical: '/hunts',
  },
  openGraph: {
    title: 'Auction Alerts & Saved Hunts | PerfectProperty',
    description: 'Save a property search, explain each match, and compare source evidence over time.',
    url: '/hunts',
    siteName: 'PerfectProperty',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Auction Alerts & Saved Hunts | PerfectProperty',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auction Alerts & Saved Hunts | PerfectProperty',
    description: 'Save a property search, explain each match, and compare source evidence over time.',
    images: ['/og-image.png'],
  },
};

export default function HuntsPage() { return <WorkspaceShell><SavedHunts /></WorkspaceShell>; }

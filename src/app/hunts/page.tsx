import type { Metadata } from 'next';
import { SavedHunts } from '@/components/hunts/saved-hunts';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export const metadata: Metadata = {
  title: 'Saved Hunts | PerfectProperty',
  description: 'Save a property search, explain each match, and compare source evidence over time.',
};

export default function HuntsPage() { return <WorkspaceShell><SavedHunts /></WorkspaceShell>; }

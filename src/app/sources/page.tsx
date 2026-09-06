import type { Metadata } from 'next';
import { SourceNetwork } from '@/components/sources/source-network';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export const metadata: Metadata = {
  title: 'Source Radar | PerfectProperty',
  description: 'Follow property sources, investigate changes, and capture evidence from government, county, lender, and auction records.',
};

export default function SourcesPage() { return <WorkspaceShell><SourceNetwork /></WorkspaceShell>; }

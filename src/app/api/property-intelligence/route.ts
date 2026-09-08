import { proxyPropertyApi } from '@/lib/property-api';
import { proxyPrivatePropertyApi } from '@/lib/workspace-proxy';

export const GET = (request: Request) => new URL(request.url).searchParams.has('snapshotId')
  ? proxyPrivatePropertyApi(request)
  : proxyPropertyApi(request);
export const POST = (request: Request) => proxyPrivatePropertyApi(request);

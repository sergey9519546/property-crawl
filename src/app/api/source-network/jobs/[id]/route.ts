import { proxyPrivatePropertyApi } from '@/lib/workspace-proxy';

export const maxDuration = 60;

export const GET = (request: Request) => proxyPrivatePropertyApi(request);

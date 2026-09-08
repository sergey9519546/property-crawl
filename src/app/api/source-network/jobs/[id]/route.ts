import { proxyPrivatePropertyApi } from '@/lib/workspace-proxy';

export const GET = (request: Request) => proxyPrivatePropertyApi(request);
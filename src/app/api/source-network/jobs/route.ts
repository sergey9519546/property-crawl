import { proxyPrivatePropertyApi } from '@/lib/workspace-proxy';

export const maxDuration = 60;

// Collection job activity list (operator session required upstream).
export const GET = (request: Request) => proxyPrivatePropertyApi(request);

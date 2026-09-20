import { proxyPrivatePropertyApi } from '@/lib/workspace-proxy';

// Collection job activity list (operator session required upstream).
export const GET = (request: Request) => proxyPrivatePropertyApi(request);

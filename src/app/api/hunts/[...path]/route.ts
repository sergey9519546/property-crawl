import { proxyPrivatePropertyApi } from '@/lib/workspace-proxy';

export const GET = (request: Request) => proxyPrivatePropertyApi(request);
export const POST = (request: Request) => proxyPrivatePropertyApi(request);
export const PATCH = (request: Request) => proxyPrivatePropertyApi(request);
export const DELETE = (request: Request) => proxyPrivatePropertyApi(request);

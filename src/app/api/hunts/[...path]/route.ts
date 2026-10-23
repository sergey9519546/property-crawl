import { proxyMemberPropertyApi } from '@/lib/workspace-proxy';

export const GET = (request: Request) => proxyMemberPropertyApi(request);
export const POST = (request: Request) => proxyMemberPropertyApi(request);
export const PATCH = (request: Request) => proxyMemberPropertyApi(request);
export const DELETE = (request: Request) => proxyMemberPropertyApi(request);

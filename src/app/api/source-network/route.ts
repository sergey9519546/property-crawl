import { proxyPropertyApi } from '@/lib/property-api';

export const maxDuration = 60;

export const GET = (request: Request) => proxyPropertyApi(request);

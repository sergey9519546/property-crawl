import { proxyPropertyApi } from '@/lib/property-api';

export const GET = (request: Request) => proxyPropertyApi(request);

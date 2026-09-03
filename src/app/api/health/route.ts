import { adapt } from "@/lib/next-adapter";
import db from "@/lib/db/client";

// /api/health — inline (no v1 handler to wrap). v2 is the source of truth.
const handleHealth = async (req: any, res: any) => {
  try {
    const sources = await db.getSources();
    res.json({
      status: "ok",
      role: "source-of-truth",
      nextjs: "healthy",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: {
        listings: db.inMemoryData?.listings?.length ?? 0,
        sources: Array.isArray(sources) ? sources.length : Object.keys(sources || {}).length
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'health failed', message: err?.message });
  }
};

export const GET = adapt(handleHealth, { securityHeaders: true, cors: true });
export const POST = GET;

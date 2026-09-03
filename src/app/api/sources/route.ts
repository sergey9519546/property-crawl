import { adapt } from "@/lib/next-adapter";
import db from "@/lib/db/client";

const handleSources = async (req: any, res: any) => {
  try {
    const sources = await db.getSources();
    res.json(sources);
  } catch (err: any) {
    res.status(500).json({ error: 'sources failed', message: err?.message });
  }
};

export const GET = adapt(handleSources, { securityHeaders: true, cors: true });

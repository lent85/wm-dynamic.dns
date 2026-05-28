import { and, desc, eq, lt } from "drizzle-orm";
import type { UpdateSource } from "@wm-ddns/shared";
import type { Db } from "../db/index.js";
import { ipChangeEvents } from "../db/schema.js";

export class IpHistoryService {
  constructor(private readonly db: Db) {}

  record(input: {
    hostnameId: number;
    recordType: "A" | "AAAA";
    previousIp: string | null;
    newIp: string;
    source: UpdateSource;
    consensusJson?: string | null;
    detectedAt?: string;
  }): void {
    this.db
      .insert(ipChangeEvents)
      .values({
        hostnameId: input.hostnameId,
        recordType: input.recordType,
        previousIp: input.previousIp,
        newIp: input.newIp,
        source: input.source,
        consensusJson: input.consensusJson ?? null,
        detectedAt: input.detectedAt ?? new Date().toISOString(),
      })
      .run();
  }

  listForHostname(
    hostnameId: number,
    opts: { limit: number; cursor?: number },
  ): { items: Array<{
    id: number;
    hostnameId: number;
    recordType: "A" | "AAAA";
    previousIp: string | null;
    newIp: string;
    source: UpdateSource;
    detectedAt: string;
    consensusJson: string | null;
  }>; nextCursor: number | null } {
    const limit = opts.limit;
    const conditions = [eq(ipChangeEvents.hostnameId, hostnameId)];
    if (opts.cursor != null) {
      conditions.push(lt(ipChangeEvents.id, opts.cursor));
    }

    const rows = this.db
      .select()
      .from(ipChangeEvents)
      .where(and(...conditions))
      .orderBy(desc(ipChangeEvents.id))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

    return {
      items: page.map((r) => ({
        id: r.id,
        hostnameId: r.hostnameId,
        recordType: r.recordType as "A" | "AAAA",
        previousIp: r.previousIp,
        newIp: r.newIp,
        source: r.source as UpdateSource,
        detectedAt: r.detectedAt,
        consensusJson: r.consensusJson,
      })),
      nextCursor,
    };
  }

  pruneOlderThan(days: number): number {
    if (days <= 0) return 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const res = this.db
      .delete(ipChangeEvents)
      .where(lt(ipChangeEvents.detectedAt, cutoff.toISOString()))
      .run();
    return res.changes;
  }
}

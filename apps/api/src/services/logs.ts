import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { hostnames, updateLogs } from "../db/schema.js";
import type { UpdateLog, UpdateLogPage, UpdateSource } from "@wm-ddns/shared";

export class LogService {
  constructor(private readonly db: Db) {}

  query(input: {
    hostnameId?: number;
    source?: UpdateSource;
    ok?: boolean;
    dispatched?: boolean;
    limit: number;
    cursor?: number;
  }): UpdateLogPage {
    const conditions = [];
    if (input.hostnameId !== undefined) {
      conditions.push(eq(updateLogs.hostnameId, input.hostnameId));
    }
    if (input.source !== undefined) conditions.push(eq(updateLogs.source, input.source));
    if (input.ok !== undefined) conditions.push(eq(updateLogs.ok, input.ok));
    if (input.dispatched !== undefined)
      conditions.push(eq(updateLogs.dispatched, input.dispatched));
    if (input.cursor !== undefined) conditions.push(lt(updateLogs.id, input.cursor));

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = this.db
      .select({ l: updateLogs, hostname: hostnames.hostname })
      .from(updateLogs)
      .leftJoin(hostnames, eq(updateLogs.hostnameId, hostnames.id))
      .where(whereExpr)
      .orderBy(desc(updateLogs.id))
      .limit(input.limit + 1)
      .all();

    const items: UpdateLog[] = rows.slice(0, input.limit).map(({ l, hostname }) => ({
      id: l.id,
      hostnameId: l.hostnameId ?? 0,
      hostname: hostname ?? undefined,
      source: l.source as UpdateSource,
      recordType: l.recordType as "A" | "AAAA",
      requestedIp: l.requestedIp,
      dispatched: l.dispatched,
      ok: l.ok,
      providerStatus: l.providerStatus,
      responseText: l.responseText,
      durationMs: l.durationMs,
      createdAt: l.createdAt,
    }));
    const nextCursor = rows.length > input.limit ? items[items.length - 1]?.id ?? null : null;
    return { items, nextCursor };
  }
}

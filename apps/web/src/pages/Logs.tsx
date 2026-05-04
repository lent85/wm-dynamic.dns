import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Hostname, UpdateLogPage, UpdateSource } from "@wm-ddns/shared";
import { api } from "../lib/api.js";

const sources: { value: UpdateSource | ""; label: string }[] = [
  { value: "", label: "All sources" },
  { value: "client-duckdns", label: "client-duckdns" },
  { value: "client-dyndns2", label: "client-dyndns2" },
  { value: "schedule", label: "schedule" },
  { value: "self-detect", label: "self-detect" },
  { value: "manual", label: "manual" },
];

export function LogsPage() {
  const [filter, setFilter] = useState({
    hostnameId: "",
    source: "" as UpdateSource | "",
    dispatched: "",
    ok: "",
  });

  const hostnames = useQuery({
    queryKey: ["hostnames"],
    queryFn: () => api<{ items: Hostname[] }>("/api/hostnames"),
  });

  const params = new URLSearchParams();
  params.set("limit", "100");
  if (filter.hostnameId) params.set("hostnameId", filter.hostnameId);
  if (filter.source) params.set("source", filter.source);
  if (filter.dispatched) params.set("dispatched", filter.dispatched);
  if (filter.ok) params.set("ok", filter.ok);

  const logs = useQuery({
    queryKey: ["logs", params.toString()],
    queryFn: () => api<UpdateLogPage>(`/api/logs?${params.toString()}`),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Update logs</h1>
        <p className="text-sm text-slate-400">
          Each row shows whether the gateway actually called the upstream provider, or skipped
          because the IP was unchanged.
        </p>
      </div>

      <div className="card">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Hostname</label>
            <select
              className="input"
              value={filter.hostnameId}
              onChange={(e) => setFilter({ ...filter, hostnameId: e.target.value })}
            >
              <option value="">All</option>
              {hostnames.data?.items.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.hostname}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Source</label>
            <select
              className="input"
              value={filter.source}
              onChange={(e) =>
                setFilter({ ...filter, source: e.target.value as UpdateSource | "" })
              }
            >
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Dispatched</label>
            <select
              className="input"
              value={filter.dispatched}
              onChange={(e) => setFilter({ ...filter, dispatched: e.target.value })}
            >
              <option value="">Any</option>
              <option value="true">Yes (called provider)</option>
              <option value="false">No (skipped)</option>
            </select>
          </div>
          <div>
            <label className="label">Result</label>
            <select
              className="input"
              value={filter.ok}
              onChange={(e) => setFilter({ ...filter, ok: e.target.value })}
            >
              <option value="">Any</option>
              <option value="true">OK</option>
              <option value="false">Failed</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Time</th>
              <th>Hostname</th>
              <th>Source</th>
              <th>Type</th>
              <th>Requested IP</th>
              <th>Dispatched</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.items.map((l) => (
              <tr key={l.id}>
                <td className="text-slate-400">
                  {new Date(l.createdAt).toLocaleString()}
                </td>
                <td className="font-medium">{l.hostname ?? l.hostnameId}</td>
                <td className="text-slate-400">{l.source}</td>
                <td>
                  <span className="badge-muted">{l.recordType}</span>
                </td>
                <td className="font-mono text-xs">{l.requestedIp ?? "—"}</td>
                <td>
                  {l.dispatched ? (
                    <span className="badge-warn">sent</span>
                  ) : (
                    <span className="badge-muted">skipped</span>
                  )}
                </td>
                <td>
                  {l.ok ? (
                    <span className="badge-ok">{l.providerStatus}</span>
                  ) : (
                    <span className="badge-err">{l.providerStatus}</span>
                  )}
                </td>
                <td className="font-mono text-xs text-slate-400">
                  {l.durationMs == null ? "—" : `${l.durationMs}ms`}
                </td>
                <td className="max-w-md truncate font-mono text-xs text-slate-500">
                  {l.responseText ?? ""}
                </td>
              </tr>
            ))}
            {logs.data && logs.data.items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  No matching logs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

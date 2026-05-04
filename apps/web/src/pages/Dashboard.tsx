import { useQuery } from "@tanstack/react-query";
import type { StatusResponse, Hostname } from "@wm-ddns/shared";
import { api } from "../lib/api.js";

export function DashboardPage() {
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => api<StatusResponse>("/api/status"),
    refetchInterval: 10_000,
  });
  const hostnames = useQuery({
    queryKey: ["hostnames"],
    queryFn: () => api<{ items: Hostname[] }>("/api/hostnames"),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-400">
          Overview of the gateway and tracked hostnames.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Hostnames" value={status.data?.hostnames ?? "—"} />
        <Stat label="Providers" value={status.data?.providers ?? "—"} />
        <Stat label="API tokens" value={status.data?.tokens ?? "—"} />
        <Stat
          label="Uptime"
          value={
            status.data ? formatUptime(status.data.uptimeSec) : "—"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="mb-3 text-sm font-medium text-slate-300">
            Detected public IP
          </div>
          <dl className="space-y-2 text-sm">
            <Row label="IPv4" value={status.data?.selfIpv4 ?? "—"} mono />
            <Row label="IPv6" value={status.data?.selfIpv6 ?? "—"} mono />
            <Row
              label="Fetched at"
              value={
                status.data?.selfIpFetchedAt
                  ? new Date(status.data.selfIpFetchedAt).toLocaleString()
                  : "—"
              }
            />
          </dl>
        </div>
        <div className="card">
          <div className="mb-3 text-sm font-medium text-slate-300">Self-detect</div>
          <p className="text-sm text-slate-400">
            Server detects its own public IP every{" "}
            <span className="font-mono text-slate-200">
              {status.data?.selfDetectIntervalSec ?? "—"}s
            </span>{" "}
            and pushes updates to hostnames flagged as <em>track-self-ip</em>.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-medium">Hostnames</h2>
          <a className="text-sm text-brand-400 hover:underline" href="/hostnames">
            Manage →
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Provider</th>
                <th>Type</th>
                <th>Last IPv4</th>
                <th>Last IPv6</th>
                <th>Last update</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {hostnames.data?.items.map((h) => (
                <tr key={h.id}>
                  <td className="font-medium">{h.hostname}</td>
                  <td className="text-slate-400">
                    {h.providerName} <span className="text-slate-600">({h.providerType})</span>
                  </td>
                  <td>
                    <span className="badge-muted">{h.recordType}</span>
                  </td>
                  <td className="font-mono text-xs">{h.lastIpv4 ?? "—"}</td>
                  <td className="font-mono text-xs">{h.lastIpv6 ?? "—"}</td>
                  <td className="text-slate-400">
                    {h.lastUpdateAt
                      ? new Date(h.lastUpdateAt).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    <StatusBadge status={h.lastStatus} enabled={h.enabled} />
                  </td>
                </tr>
              ))}
              {hostnames.data && hostnames.data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No hostnames yet. Add one in the Hostnames tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
    </div>
  );
}

function StatusBadge({ status, enabled }: { status: string | null; enabled: boolean }) {
  if (!enabled) return <span className="badge-muted">disabled</span>;
  if (!status) return <span className="badge-muted">never</span>;
  if (status.startsWith("error")) return <span className="badge-err">{status}</span>;
  if (status === "good") return <span className="badge-ok">good</span>;
  if (status === "nochg") return <span className="badge-warn">nochg</span>;
  return <span className="badge-muted">{status}</span>;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

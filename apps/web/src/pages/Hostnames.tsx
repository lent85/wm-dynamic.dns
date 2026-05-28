import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { AppSettings, Hostname, IpChangeEvent, ProviderDetail } from "@wm-ddns/shared";
import { api } from "../lib/api.js";
import { Modal } from "./Providers.js";

const FORCE_PRESETS = [
  { label: "60 min", sec: 3600 },
  { label: "120 min", sec: 7200 },
  { label: "180 min", sec: 10800 },
] as const;

export function HostnamesPage() {
  const qc = useQueryClient();
  const hostnames = useQuery({
    queryKey: ["hostnames"],
    queryFn: () => api<{ items: Hostname[] }>("/api/hostnames"),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<AppSettings>("/api/settings"),
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ items: ProviderDetail[] }>("/api/providers"),
  });
  const [editing, setEditing] = useState<{ kind: "create" } | { kind: "edit"; row: Hostname } | null>(
    null,
  );
  const [historyId, setHistoryId] = useState<number | null>(null);

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/hostnames/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("hostname deleted");
      void qc.invalidateQueries({ queryKey: ["hostnames"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const force = useMutation({
    mutationFn: (id: number) =>
      api(`/api/hostnames/${id}/force-update`, {
        method: "POST",
        body: JSON.stringify({ useSelfDetect: true }),
      }),
    onSuccess: () => {
      toast.success("update dispatched");
      void qc.invalidateQueries({ queryKey: ["hostnames"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const defaultForceSec = settings.data?.defaultForceIntervalSec ?? 3600;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hostnames</h1>
          <p className="text-sm text-slate-400">
            Hostname → provider mappings, schedules, and update strategy.
          </p>
        </div>
        <button
          className="btn-primary"
          disabled={(providers.data?.items.length ?? 0) === 0}
          onClick={() => setEditing({ kind: "create" })}
        >
          Add hostname
        </button>
      </div>
      {(providers.data?.items.length ?? 0) === 0 && (
        <div className="card text-sm text-amber-400">
          You need to create at least one provider before adding hostnames.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Hostname</th>
              <th>Provider</th>
              <th>Type</th>
              <th>Schedule</th>
              <th>Force</th>
              <th>Track self IP</th>
              <th>Last update</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hostnames.data?.items.map((h) => (
              <tr key={h.id}>
                <td className="font-medium">{h.hostname}</td>
                <td className="text-slate-400">{h.providerName}</td>
                <td>
                  <span className="badge-muted">{h.recordType}</span>
                </td>
                <td className="font-mono text-xs">{h.scheduleCron ?? "—"}</td>
                <td className="text-slate-400">
                  {formatForceInterval(h.forceIntervalSec, defaultForceSec)}
                </td>
                <td>{h.trackSelfIp ? <span className="badge-ok">yes</span> : "—"}</td>
                <td className="text-slate-500">
                  {h.lastUpdateAt ? new Date(h.lastUpdateAt).toLocaleString() : "—"}
                  {(h.lastIpv4 || h.lastIpv6) && (
                    <div className="font-mono text-xs text-slate-600">
                      {h.lastIpv4 ?? "—"}
                      {h.lastIpv6 ? ` / ${h.lastIpv6}` : ""}
                    </div>
                  )}
                </td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  <button className="btn-ghost" onClick={() => setHistoryId(h.id)}>
                    IP history
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => force.mutate(h.id)}
                    disabled={force.isPending}
                  >
                    Force update
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => setEditing({ kind: "edit", row: h })}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-danger"
                    onClick={() => {
                      if (confirm(`Delete "${h.hostname}"?`)) del.mutate(h.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {hostnames.data && hostnames.data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">
                  No hostnames yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && providers.data && settings.data && (
        <HostnameForm
          providers={providers.data.items}
          appSettings={settings.data}
          existing={editing.kind === "edit" ? editing.row : null}
          onClose={() => setEditing(null)}
        />
      )}

      {historyId != null && (
        <IpHistoryModal hostnameId={historyId} onClose={() => setHistoryId(null)} />
      )}
    </div>
  );
}

function IpHistoryModal({
  hostnameId,
  onClose,
}: {
  hostnameId: number;
  onClose: () => void;
}) {
  const history = useQuery({
    queryKey: ["ip-history", hostnameId],
    queryFn: () =>
      api<{ items: IpChangeEvent[]; nextCursor: number | null }>(
        `/api/hostnames/${hostnameId}/ip-history?limit=50`,
      ),
  });

  return (
    <Modal onClose={onClose} title="IP change history">
      <div className="max-h-[24rem] space-y-2 overflow-y-auto">
        {history.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {history.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">No IP changes recorded yet.</p>
        )}
        {history.data?.items.map((e) => (
          <div
            key={e.id}
            className="rounded border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-sm"
          >
            <div className="flex justify-between text-slate-400">
              <span className="badge-muted">{e.recordType}</span>
              <span>{new Date(e.detectedAt).toLocaleString()}</span>
            </div>
            <div className="mt-1 font-mono">
              {e.previousIp ?? "—"} → {e.newIp}
            </div>
            <div className="mt-1 text-xs text-slate-500">source: {e.source}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function HostnameForm({
  providers,
  appSettings,
  existing,
  onClose,
}: {
  providers: ProviderDetail[];
  appSettings: AppSettings;
  existing: Hostname | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [inheritForce, setInheritForce] = useState(
    existing ? existing.forceIntervalSec == null : true,
  );
  const [form, setForm] = useState({
    hostname: existing?.hostname ?? "",
    providerId: existing?.providerId ?? providers[0]?.id ?? 0,
    recordType: existing?.recordType ?? "A",
    ttl: existing?.ttl ?? appSettings.defaultTtl,
    forceIntervalSec:
      existing?.forceIntervalSec ?? appSettings.defaultForceIntervalSec,
    scheduleCron: existing?.scheduleCron ?? "",
    trackSelfIp: existing?.trackSelfIp ?? false,
    enabled: existing?.enabled ?? true,
  });

  const validateCron = useMutation({
    mutationFn: (expr: string) =>
      api<{ valid: boolean; error?: string; nextRuns?: string[] }>(
        "/api/cron/validate",
        { method: "POST", body: JSON.stringify({ expr }) },
      ),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        hostname: form.hostname,
        providerId: form.providerId,
        recordType: form.recordType,
        ttl: form.ttl,
        forceIntervalSec: inheritForce ? null : form.forceIntervalSec,
        scheduleCron: form.scheduleCron.trim() === "" ? null : form.scheduleCron.trim(),
        trackSelfIp: form.trackSelfIp,
        enabled: form.enabled,
      };
      if (isEdit && existing) {
        return api(`/api/hostnames/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }
      return api("/api/hostnames", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      toast.success(isEdit ? "hostname updated" : "hostname created");
      void qc.invalidateQueries({ queryKey: ["hostnames"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Modal onClose={onClose} title={isEdit ? "Edit hostname" : "New hostname"}>
      <div className="space-y-4">
        <div>
          <label className="label">Hostname</label>
          <input
            className="input"
            value={form.hostname}
            onChange={(e) => setForm({ ...form, hostname: e.target.value })}
            placeholder="home.example.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Provider</label>
            <select
              className="input"
              value={form.providerId}
              onChange={(e) =>
                setForm({ ...form, providerId: Number(e.target.value) })
              }
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Record type</label>
            <select
              className="input"
              value={form.recordType}
              onChange={(e) =>
                setForm({ ...form, recordType: e.target.value as "A" | "AAAA" | "BOTH" })
              }
            >
              <option value="A">A (IPv4)</option>
              <option value="AAAA">AAAA (IPv6)</option>
              <option value="BOTH">Both</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">TTL (seconds)</label>
            <input
              className="input"
              type="number"
              value={form.ttl}
              onChange={(e) => setForm({ ...form, ttl: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Force interval</label>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={inheritForce}
                onChange={(e) => {
                  setInheritForce(e.target.checked);
                  if (e.target.checked) {
                    setForm({
                      ...form,
                      forceIntervalSec: appSettings.defaultForceIntervalSec,
                    });
                  }
                }}
              />
              Use global default ({formatSec(appSettings.defaultForceIntervalSec)})
            </label>
            {!inheritForce && (
              <>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.forceIntervalSec}
                  onChange={(e) =>
                    setForm({ ...form, forceIntervalSec: Number(e.target.value) })
                  }
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {FORCE_PRESETS.map((p) => (
                    <button
                      key={p.sec}
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => setForm({ ...form, forceIntervalSec: p.sec })}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => setForm({ ...form, forceIntervalSec: 0 })}
                  >
                    Off
                  </button>
                </div>
              </>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Re-push to provider even when IP unchanged after this long. 0 = only on IP change.
            </p>
          </div>
        </div>
        <div>
          <label className="label">Schedule (cron, optional)</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={form.scheduleCron}
              onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
              placeholder="*/15 * * * *"
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                form.scheduleCron && validateCron.mutate(form.scheduleCron)
              }
            >
              Test
            </button>
          </div>
          {validateCron.data && (
            <div className="mt-2 text-xs">
              {validateCron.data.valid ? (
                <div className="text-emerald-400">
                  Next runs:
                  <ul className="ml-4 list-disc font-mono text-slate-400">
                    {validateCron.data.nextRuns?.slice(0, 3).map((r) => (
                      <li key={r}>{new Date(r).toLocaleString()}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-red-400">Invalid: {validateCron.data.error}</div>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.trackSelfIp}
              onChange={(e) => setForm({ ...form, trackSelfIp: e.target.checked })}
            />
            Track server's own public IP
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function formatForceInterval(
  sec: number | null,
  globalDefault: number,
): string {
  if (sec == null) return `default (${formatSec(globalDefault)})`;
  return formatSec(sec);
}

function formatSec(sec: number): string {
  if (sec === 0) return "off";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

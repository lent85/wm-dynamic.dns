import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { Hostname, ProviderDetail } from "@wm-ddns/shared";
import { api } from "../lib/api.js";
import { Modal } from "./Providers.js";

export function HostnamesPage() {
  const qc = useQueryClient();
  const hostnames = useQuery({
    queryKey: ["hostnames"],
    queryFn: () => api<{ items: Hostname[] }>("/api/hostnames"),
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ items: ProviderDetail[] }>("/api/providers"),
  });
  const [editing, setEditing] = useState<{ kind: "create" } | { kind: "edit"; row: Hostname } | null>(
    null,
  );

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
                <td className="text-slate-400">{formatSec(h.forceIntervalSec)}</td>
                <td>{h.trackSelfIp ? <span className="badge-ok">yes</span> : "—"}</td>
                <td className="text-slate-500">
                  {h.lastUpdateAt ? new Date(h.lastUpdateAt).toLocaleString() : "—"}
                </td>
                <td className="space-x-2 whitespace-nowrap text-right">
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

      {editing && providers.data && (
        <HostnameForm
          providers={providers.data.items}
          existing={editing.kind === "edit" ? editing.row : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function HostnameForm({
  providers,
  existing,
  onClose,
}: {
  providers: ProviderDetail[];
  existing: Hostname | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [form, setForm] = useState({
    hostname: existing?.hostname ?? "",
    providerId: existing?.providerId ?? providers[0]?.id ?? 0,
    recordType: existing?.recordType ?? "A",
    ttl: existing?.ttl ?? 300,
    forceIntervalSec: existing?.forceIntervalSec ?? 86400,
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
        ...form,
        scheduleCron: form.scheduleCron.trim() === "" ? null : form.scheduleCron.trim(),
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
            <label className="label">Force interval (seconds)</label>
            <input
              className="input"
              type="number"
              value={form.forceIntervalSec}
              onChange={(e) =>
                setForm({ ...form, forceIntervalSec: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              Re-push to provider even when IP unchanged after this long.
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

function formatSec(sec: number): string {
  if (sec === 0) return "off";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type {
  AppSettings,
  Hostname,
  IpChangeEvent,
  ProviderDetail,
  UpdateLog,
  ClientToken,
} from "@wm-ddns/shared";
import { api } from "../lib/api.js";
import { Modal } from "./Providers.js";
import { IssuedTokenModal } from "./Tokens.js";

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
              <th>IP History (Last 4)</th>
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
                <td className="py-2">
                  {h.recentIpHistory && h.recentIpHistory.length > 0 ? (
                    <div className="space-y-1">
                      {h.recentIpHistory.slice(0, 4).map((item, idx) => (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between gap-4 text-xs ${
                            idx === 0 ? "text-emerald-400 font-medium" : "text-slate-500"
                          }`}
                        >
                          <span className="font-mono">
                            <span className="text-[10px] text-slate-500 bg-slate-800 px-1 py-0.5 rounded mr-1">
                              {item.recordType}
                            </span>
                            {item.newIp}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(item.detectedAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : h.lastIpv4 || h.lastIpv6 ? (
                    <div className="flex items-center justify-between gap-4 text-xs text-emerald-400 font-medium">
                      <span className="font-mono">
                        {h.lastIpv4 || h.lastIpv6}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {h.lastUpdateAt ? new Date(h.lastUpdateAt).toLocaleString() : "—"}
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-500">—</span>
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
  const [showFull, setShowFull] = useState(false);

  const changes = useQuery({
    queryKey: ["ip-history", hostnameId],
    queryFn: () =>
      api<{ items: IpChangeEvent[]; nextCursor: number | null }>(
        `/api/hostnames/${hostnameId}/ip-history?limit=50`,
      ),
    enabled: !showFull,
  });

  const allRuns = useQuery({
    queryKey: ["logs", hostnameId, "full"],
    queryFn: () =>
      api<{ items: UpdateLog[]; nextCursor: number | null }>(
        `/api/logs?hostnameId=${hostnameId}&limit=50`,
      ),
    enabled: showFull,
  });

  const loading = showFull ? allRuns.isLoading : changes.isLoading;
  const error = showFull ? allRuns.error : changes.error;

  return (
    <Modal onClose={onClose} title="IP change history">
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          className="rounded border-slate-600"
          checked={showFull}
          onChange={(e) => setShowFull(e.target.checked)}
        />
        Show all update runs (including unchanged IP)
      </label>

      <div className="max-h-[24rem] space-y-2 overflow-y-auto">
        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        {error && (
          <p className="text-sm text-red-400">
            {error instanceof Error ? error.message : "Failed to load"}
          </p>
        )}

        {!showFull && !loading && changes.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">No IP changes recorded yet.</p>
        )}
        {!showFull &&
          changes.data?.items.map((e) => (
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

        {showFull && !loading && allRuns.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">No update runs recorded yet.</p>
        )}
        {showFull &&
          allRuns.data?.items.map((l) => (
            <UpdateRunRow key={l.id} log={l} />
          ))}
      </div>
    </Modal>
  );
}

function UpdateRunRow({ log }: { log: UpdateLog }) {
  const ipUnchanged = !log.dispatched && log.providerStatus === "nochg";

  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        ipUnchanged
          ? "border-slate-800/80 bg-slate-950/40 opacity-75"
          : "border-slate-700/60 bg-slate-900/40"
      }`}
    >
      <div className="flex justify-between text-slate-400">
        <span className="badge-muted">{log.recordType}</span>
        <span>{new Date(log.createdAt).toLocaleString()}</span>
      </div>
      <div className="mt-1 font-mono">{log.requestedIp ?? "—"}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>source: {log.source}</span>
        {log.dispatched ? (
          <span className="badge-warn">sent</span>
        ) : (
          <span className="badge-muted">skipped</span>
        )}
        {ipUnchanged ? (
          <span className="badge-muted">IP unchanged</span>
        ) : log.dispatched ? (
          <span className="badge-ok">dispatched</span>
        ) : null}
        <span className={log.ok ? "text-slate-500" : "text-red-400"}>
          {log.providerStatus}
        </span>
      </div>
    </div>
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

  const [ipMode, setIpMode] = useState<"self" | "url" | "domain" | "token">(() => {
    if (!existing) return "self";
    if (existing.trackSelfIp) return "self";
    if (existing.ipSourceUrl) return "url";
    if (existing.ipSourceDomain) return "domain";
    return "token";
  });

  const [newToken, setNewToken] = useState<{ plainToken: string } | null>(null);

  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: () => api<{ items: ClientToken[] }>("/api/tokens"),
  });

  const [form, setForm] = useState({
    hostname: existing?.hostname ?? "",
    providerId: existing?.providerId ?? providers[0]?.id ?? 0,
    recordType: existing?.recordType ?? "A",
    ttl: existing?.ttl ?? appSettings.defaultTtl,
    forceIntervalSec:
      existing?.forceIntervalSec ?? appSettings.defaultForceIntervalSec,
    scheduleCron: existing?.scheduleCron ?? "",
    ipSourceUrl: existing?.ipSourceUrl ?? "",
    ipSourceDomain: existing?.ipSourceDomain ?? "",
    selectedTokenIds: [] as number[],
    newTokenLabel: "",
    enabled: existing?.enabled ?? true,
  });

  useEffect(() => {
    if (isEdit && existing && tokens.data) {
      const associated = tokens.data.items
        .filter((t) => t.scopeHostnameIds.includes(existing.id))
        .map((t) => t.id);
      setForm((prev) => ({ ...prev, selectedTokenIds: associated }));
    }
  }, [tokens.data, isEdit, existing]);

  let sourceError: string | null = null;
  if (ipMode === "url" && !form.ipSourceUrl.trim()) {
    sourceError = "API URL is required when using custom API update mode.";
  } else if (ipMode === "domain" && !form.ipSourceDomain.trim()) {
    sourceError = "Domain to follow is required when using follow domain mode.";
  }

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
        trackSelfIp: ipMode === "self",
        ipSourceUrl: ipMode === "url" ? form.ipSourceUrl.trim() || null : null,
        ipSourceDomain: ipMode === "domain" ? form.ipSourceDomain.trim() || null : null,
        enabled: form.enabled,
        associatedTokenIds: ipMode === "token" ? form.selectedTokenIds : [],
        createAssociatedTokenLabel:
          ipMode === "token" && form.newTokenLabel.trim() ? form.newTokenLabel.trim() : undefined,
      };
      if (isEdit && existing) {
        return api<{ newAssociatedToken?: { plainToken: string; label: string } }>(
          `/api/hostnames/${existing.id}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          },
        );
      }
      return api<{ newAssociatedToken?: { plainToken: string; label: string } }>(
        "/api/hostnames",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: (data) => {
      toast.success(isEdit ? "hostname updated" : "hostname created");
      if (data?.newAssociatedToken) {
        setNewToken(data.newAssociatedToken);
      } else {
        void qc.invalidateQueries({ queryKey: ["hostnames"] });
        onClose();
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (newToken) {
    return (
      <IssuedTokenModal
        token={newToken}
        onClose={() => {
          void qc.invalidateQueries({ queryKey: ["hostnames"] });
          onClose();
        }}
      />
    );
  }

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

        {/* ── IP Update Mode ───────────────────────────────────────────── */}
        <div className="space-y-3">
          <label className="label">IP update mode</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "self", label: "🖥️ Server public IP", desc: "Detect this server's own IP" },
              { value: "url", label: "🌐 Custom API URL", desc: "Fetch IP from a URL" },
              { value: "domain", label: "🔗 Follow domain", desc: "Resolve A/AAAA of a domain" },
              { value: "token", label: "🔑 API token push", desc: "Client pushes via token" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setIpMode(opt.value)}
                className={`rounded border px-3 py-2 text-left text-sm transition-colors ${
                  ipMode === opt.value
                    ? "border-brand-400 bg-brand-400/10 text-brand-300"
                    : "border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-500"
                }`}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{opt.desc}</div>
              </button>
            ))}
          </div>

          {/* Mode: Server public IP */}
          {ipMode === "self" && (
            <p className="text-xs text-slate-400">
              The server will detect its own public IP every{" "}
              <span className="font-mono">{appSettings.selfDetectIntervalSec ?? 300}s</span>{" "}
              and automatically push the update.
            </p>
          )}

          {/* Mode: Custom API URL */}
          {ipMode === "url" && (
            <div>
              <label className="label">API URL (returns plain-text IP)</label>
              <input
                className="input"
                value={form.ipSourceUrl}
                onChange={(e) => setForm({ ...form, ipSourceUrl: e.target.value })}
                placeholder="https://api.ipify.org"
              />
              <p className="mt-1 text-xs text-slate-500">
                The server will fetch this URL on each detect cycle. The response must be a
                plain-text IPv4 or IPv6 address.
              </p>
            </div>
          )}

          {/* Mode: Follow domain */}
          {ipMode === "domain" && (
            <div>
              <label className="label">Domain to follow</label>
              <input
                className="input"
                value={form.ipSourceDomain}
                onChange={(e) => setForm({ ...form, ipSourceDomain: e.target.value })}
                placeholder="myrouter.asuscomm.com"
              />
              <p className="mt-1 text-xs text-slate-500">
                The server will resolve the A/AAAA records of this domain and use the first
                result as the target IP on each detect cycle.
              </p>
            </div>
          )}

          {/* Mode: API Token push */}
          {ipMode === "token" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                An external client (router / cron / ddclient) pushes the IP via the server's
                own update API using an API token. The server does not actively detect the IP.
              </p>

              {/* Existing tokens */}
              {tokens.data && tokens.data.items.length > 0 && (
                <div>
                  <label className="label">Associate existing tokens</label>
                  <div className="max-h-36 space-y-1 overflow-auto rounded border border-slate-700 bg-slate-950 p-2">
                    {tokens.data.items.map((t) => {
                      const isGlobal = t.scopeHostnameIds.length === 0;
                      return (
                        <label key={t.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            disabled={isGlobal}
                            checked={isGlobal || form.selectedTokenIds.includes(t.id)}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                selectedTokenIds: e.target.checked
                                  ? [...form.selectedTokenIds, t.id]
                                  : form.selectedTokenIds.filter((id) => id !== t.id),
                              })
                            }
                          />
                          <span className="font-mono">{t.label}</span>
                          {isGlobal && (
                            <span className="badge-warn text-[10px]">global</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Create new token */}
              <div>
                <label className="label">Or generate a new token for this hostname</label>
                <input
                  className="input"
                  value={form.newTokenLabel}
                  onChange={(e) => setForm({ ...form, newTokenLabel: e.target.value })}
                  placeholder={`token-${form.hostname || "hostname"}`}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave blank to skip. If filled, a new token scoped to this hostname will be
                  created and displayed after saving.
                </p>
              </div>
            </div>
          )}

          {sourceError && (
            <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              ⚠️ {sourceError}
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Enabled
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !!sourceError}
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

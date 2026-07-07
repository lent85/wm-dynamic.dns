import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type {
  ClientToken,
  ClientTokenCreateResponse,
  Hostname,
} from "@wm-ddns/shared";
import { api } from "../lib/api.js";
import { Modal } from "./Providers.js";

export function TokensPage() {
  const qc = useQueryClient();
  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: () => api<{ items: ClientToken[] }>("/api/tokens"),
  });
  const hostnames = useQuery({
    queryKey: ["hostnames"],
    queryFn: () => api<{ items: Hostname[] }>("/api/hostnames"),
  });

  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<ClientTokenCreateResponse | null>(null);

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("token revoked");
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Tokens</h1>
          <p className="text-sm text-slate-400">
            Tokens for DDNS clients (mobile / cron / Task Scheduler / router).
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          Issue token
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Label</th>
              <th>Scope</th>
              <th>Expires</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.data?.items.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.label}</td>
                <td className="text-slate-400">
                  {t.scopeHostnameIds.length === 0 ? (
                    <span className="badge-warn">all hostnames</span>
                  ) : (
                    <span className="badge-muted">
                      {t.scopeHostnameIds.length} hostname(s)
                    </span>
                  )}
                </td>
                <td className="text-slate-500">
                  {t.expiresAt ? new Date(t.expiresAt).toLocaleString() : "never"}
                </td>
                <td className="text-slate-500">
                  {t.lastUsedAt ? (
                    <>
                      {new Date(t.lastUsedAt).toLocaleString()}
                      {t.lastUsedIp && (
                        <span className="ml-2 font-mono text-xs">{t.lastUsedIp}</span>
                      )}
                    </>
                  ) : (
                    "never"
                  )}
                </td>
                <td className="text-right">
                  <button
                    className="btn-danger"
                    onClick={() => {
                      if (confirm(`Revoke token "${t.label}"?`)) del.mutate(t.id);
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {tokens.data && tokens.data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  No tokens yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && hostnames.data && (
        <CreateTokenForm
          hostnames={hostnames.data.items}
          onClose={() => setCreating(false)}
          onIssued={setIssued}
        />
      )}
      {issued && <IssuedTokenModal token={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

function CreateTokenForm({
  hostnames,
  onClose,
  onIssued,
}: {
  hostnames: Hostname[];
  onClose: () => void;
  onIssued: (t: ClientTokenCreateResponse) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<number[]>([]);
  const [scopeAll, setScopeAll] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      api<ClientTokenCreateResponse>("/api/tokens", {
        method: "POST",
        body: JSON.stringify({
          label,
          scopeHostnameIds: scopeAll ? [] : scope,
          expiresAt: null,
        }),
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["tokens"] });
      onIssued(data);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Modal onClose={onClose} title="Issue API token">
      <div className="space-y-4">
        <div>
          <label className="label">Label</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="home-server"
          />
        </div>
        <div>
          <label className="label">Scope</label>
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={scopeAll}
              onChange={(e) => setScopeAll(e.target.checked)}
            />
            All hostnames (current and future)
          </label>
          {!scopeAll && (
            <div className="max-h-48 space-y-1 overflow-auto rounded border border-slate-800 bg-slate-950 p-2">
              {hostnames.map((h) => (
                <label key={h.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scope.includes(h.id)}
                    onChange={(e) =>
                      setScope(
                        e.target.checked
                          ? [...scope, h.id]
                          : scope.filter((id) => id !== h.id),
                      )
                    }
                  />
                  <span className="font-mono">{h.hostname}</span>
                </label>
              ))}
              {hostnames.length === 0 && (
                <div className="text-xs text-slate-500">No hostnames defined yet.</div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!label || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Issuing…" : "Issue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function IssuedTokenModal({
  token,
  onClose,
}: {
  token: { plainToken: string };
  onClose: () => void;
}) {
  const origin = window.location.origin;
  const t = token.plainToken;
  const example1 = `curl -fsS "${origin}/update?token=${t}&domains=YOUR_HOSTNAME&ip=auto"`;
  const example2 = `curl -fsS -u "any:${t}" "${origin}/nic/update?hostname=YOUR_HOSTNAME"`;
  const cron = `*/5 * * * * ${example1} >/dev/null`;
  const schtasks = `schtasks /Create /SC MINUTE /MO 5 /TN wm-ddns /TR "curl.exe -fsS \\"${origin}/update?token=${t}&domains=YOUR_HOSTNAME&ip=auto\\""`;

  return (
    <Modal onClose={onClose} title="Token issued — copy now">
      <p className="mb-3 text-sm text-amber-400">
        This token is shown only once. Copy it now; you will not be able to retrieve it later.
      </p>
      <Snippet label="Plain token" value={t} />
      <Snippet label="DuckDNS-style curl" value={example1} />
      <Snippet label="dyndns2-style curl" value={example2} />
      <Snippet label="Linux cron (every 5 min)" value={cron} />
      <Snippet label="Windows Task Scheduler" value={schtasks} multiline />
      <div className="flex justify-end pt-3">
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function Snippet({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success("copied");
          }}
        >
          Copy
        </button>
      </div>
      <pre
        className={`overflow-x-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-300 ${multiline ? "whitespace-pre-wrap break-all" : ""}`}
      >
        {value}
      </pre>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { ProviderDetail, ProviderTypeMeta } from "@wm-ddns/shared";
import { api } from "../lib/api.js";

export function ProvidersPage() {
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ["provider-types"],
    queryFn: () => api<{ items: ProviderTypeMeta[] }>("/api/providers/types"),
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ items: ProviderDetail[] }>("/api/providers"),
  });

  const [editing, setEditing] = useState<{ kind: "create" } | { kind: "edit"; row: ProviderDetail } | null>(
    null,
  );

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/providers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("provider deleted");
      void qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
          <p className="text-sm text-slate-400">DNS upstreams the gateway pushes updates to.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ kind: "create" })}>
          Add provider
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {providers.data?.items.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.name}</td>
                <td className="text-slate-400">{p.type}</td>
                <td className="text-slate-500">{new Date(p.createdAt).toLocaleString()}</td>
                <td className="text-right">
                  <button
                    className="btn-ghost mr-2"
                    onClick={() => setEditing({ kind: "edit", row: p })}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-danger"
                    onClick={() => {
                      if (confirm(`Delete provider "${p.name}"?`)) del.mutate(p.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {providers.data && providers.data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-500">
                  No providers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && types.data && (
        <ProviderForm
          types={types.data.items}
          existing={editing.kind === "edit" ? editing.row : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProviderForm({
  types,
  existing,
  onClose,
}: {
  types: ProviderTypeMeta[];
  existing: ProviderDetail | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [type, setType] = useState<string>(existing?.type ?? types[0]?.type ?? "");
  const [name, setName] = useState<string>(existing?.name ?? "");
  const meta = useMemo(() => types.find((t) => t.type === type), [types, type]);
  const initialConfig: Record<string, string> = {};
  for (const f of meta?.fields ?? []) {
    const v = existing?.config?.[f.name];
    initialConfig[f.name] = v == null ? "" : String(v);
  }
  const [config, setConfig] = useState<Record<string, string>>(initialConfig);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, config: cleanConfig(config, meta) };
      if (isEdit && existing) {
        return api(`/api/providers/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }
      return api("/api/providers", {
        method: "POST",
        body: JSON.stringify({ ...payload, type }),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "provider updated" : "provider created");
      void qc.invalidateQueries({ queryKey: ["providers"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Modal onClose={onClose} title={isEdit ? "Edit provider" : "New provider"}>
      <div className="space-y-4">
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setConfig({});
            }}
            disabled={isEdit}
          >
            {types.map((t) => (
              <option key={t.type} value={t.type}>
                {t.displayName} ({t.type})
              </option>
            ))}
          </select>
          {meta?.description && (
            <p className="mt-1 text-xs text-slate-500">{meta.description}</p>
          )}
        </div>
        <div>
          <label className="label">Name (display only)</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-cloudflare"
          />
        </div>
        {meta?.fields.map((f) => (
          <div key={f.name}>
            <label className="label">
              {f.label}
              {!f.required && <span className="ml-1 text-slate-600">(optional)</span>}
            </label>
            <input
              className="input"
              type={f.type === "password" ? "password" : "text"}
              value={config[f.name] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setConfig({ ...config, [f.name]: e.target.value })}
            />
            {f.description && (
              <p className="mt-1 text-xs text-slate-500">{f.description}</p>
            )}
          </div>
        ))}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={save.isPending || !name || !type}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function cleanConfig(
  cfg: Record<string, string>,
  meta: ProviderTypeMeta | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of meta?.fields ?? []) {
    const v = cfg[f.name];
    if (v === undefined || v === "") continue;
    if (v === "********") continue;
    out[f.name] = v;
  }
  return out;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-medium">{title}</h3>
          <button className="btn-ghost" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

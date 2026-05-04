import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { AppSettings } from "@wm-ddns/shared";
import { api } from "../lib/api.js";

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<AppSettings>("/api/settings"),
  });
  const [form, setForm] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings.data && form === null) setForm(settings.data);
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (patch: Partial<AppSettings>) =>
      api<AppSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      toast.success("settings saved");
      setForm(data);
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const password = useMutation({
    mutationFn: (vars: { current: string; next: string }) =>
      api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: vars.current,
          newPassword: vars.next,
        }),
      }),
    onSuccess: () => toast.success("password changed"),
    onError: (err: Error) => toast.error(err.message),
  });

  if (!form) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="card space-y-4">
        <div className="text-base font-medium">Update strategy defaults</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">Default TTL (seconds)</label>
            <input
              className="input"
              type="number"
              value={form.defaultTtl}
              onChange={(e) => setForm({ ...form, defaultTtl: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Default force interval (seconds)</label>
            <input
              className="input"
              type="number"
              value={form.defaultForceIntervalSec}
              onChange={(e) =>
                setForm({ ...form, defaultForceIntervalSec: Number(e.target.value) })
              }
            />
          </div>
        </div>

        <div className="text-base font-medium pt-4">Self-IP detect</div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.selfDetectEnabled}
            onChange={(e) => setForm({ ...form, selfDetectEnabled: e.target.checked })}
          />
          Enable scheduled public IP detection
        </label>
        <div>
          <label className="label">Detect interval (seconds)</label>
          <input
            className="input"
            type="number"
            value={form.selfDetectIntervalSec}
            onChange={(e) =>
              setForm({ ...form, selfDetectIntervalSec: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <label className="label">Public IP providers (one per line)</label>
          <textarea
            className="input min-h-[6rem]"
            value={form.publicIpProviders.join("\n")}
            onChange={(e) =>
              setForm({
                ...form,
                publicIpProviders: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            className="btn-primary"
            onClick={() => save.mutate(form)}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>

      <ChangePassword
        onChange={(current, next) => password.mutate({ current, next })}
        busy={password.isPending}
      />
    </div>
  );
}

function ChangePassword({
  onChange,
  busy,
}: {
  onChange: (current: string, next: string) => void;
  busy: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <div className="card space-y-3">
      <div className="text-base font-medium">Change admin password</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">Current password</label>
          <input
            className="input"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label className="label">New password</label>
          <input
            className="input"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          className="btn-primary"
          disabled={busy || !current || next.length < 8 || next !== confirm}
          onClick={() => {
            onChange(current, next);
            setCurrent("");
            setNext("");
            setConfirm("");
          }}
        >
          {busy ? "Changing…" : "Change password"}
        </button>
      </div>
    </div>
  );
}

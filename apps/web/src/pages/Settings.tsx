import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type {
  AppSettings,
  PublicIpServiceConfig,
  RuntimeConfigPublic,
  RuntimeConfigPutResponse,
  RuntimeConfigUpdateRequest,
} from "@wm-ddns/shared";
import { api } from "../lib/api.js";

const SECTION_IDS = {
  application: "settings-application",
  externalIp: "settings-external-ip",
  runtime: "settings-runtime",
  password: "settings-password",
} as const;

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function createIpServiceDraft(index: number): PublicIpServiceConfig {
  return {
    id: `custom-${Date.now()}-${index}`,
    name: `Service ${index + 1}`,
    url: "",
    enabled: true,
  };
}

function updateIpService(
  form: AppSettings,
  setForm: (next: AppSettings) => void,
  index: number,
  patch: Partial<PublicIpServiceConfig>,
): void {
  const next = form.publicIpServices.map((svc, i) => (i === index ? { ...svc, ...patch } : svc));
  setForm({ ...form, publicIpServices: next });
}

function scrollToSection(id: string): void {
  window.history.replaceState(null, "", `#${id}`);
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<AppSettings>("/api/settings"),
  });
  const runtimeCfg = useQuery({
    queryKey: ["runtime-config"],
    queryFn: () => api<RuntimeConfigPublic>("/api/runtime-config"),
  });

  const [form, setForm] = useState<AppSettings | null>(null);
  const [appBaseline, setAppBaseline] = useState<AppSettings | null>(null);
  const appHydrated = useRef(false);

  const [runtimeBaseline, setRuntimeBaseline] = useState<RuntimeConfigPublic | null>(null);
  const [runtimeForm, setRuntimeForm] = useState({
    jwtSecret: "",
    appEncryptionKey: "",
    logLevel: "info" as RuntimeConfigPublic["logLevel"],
    corsOrigin: "",
  });
  const runtimeHydrated = useRef(false);

  useEffect(() => {
    if (!settings.data || appHydrated.current) return;
    appHydrated.current = true;
    setForm(structuredClone(settings.data));
    setAppBaseline(structuredClone(settings.data));
  }, [settings.data]);

  useEffect(() => {
    if (!runtimeCfg.data || runtimeHydrated.current) return;
    runtimeHydrated.current = true;
    setRuntimeBaseline(runtimeCfg.data);
    setRuntimeForm((f) => ({
      ...f,
      logLevel: runtimeCfg.data!.logLevel,
      corsOrigin: runtimeCfg.data!.corsOrigin ?? "",
    }));
  }, [runtimeCfg.data]);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (id && Object.values(SECTION_IDS).includes(id as (typeof SECTION_IDS)[keyof typeof SECTION_IDS])) {
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, []);

  const appDirty = useMemo(() => {
    if (!form || !appBaseline) return false;
    return JSON.stringify(form) !== JSON.stringify(appBaseline);
  }, [form, appBaseline]);

  const runtimeDirty = useMemo(() => {
    if (!runtimeBaseline) return false;
    const corsBase = runtimeBaseline.corsOrigin ?? "";
    return (
      runtimeForm.logLevel !== runtimeBaseline.logLevel ||
      runtimeForm.corsOrigin !== corsBase ||
      runtimeForm.jwtSecret.trim() !== "" ||
      runtimeForm.appEncryptionKey.trim() !== ""
    );
  }, [runtimeForm, runtimeBaseline]);

  const dirty = appDirty || runtimeDirty;

  const saveSettings = useMutation({
    mutationFn: (patch: AppSettings) =>
      api<AppSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      setForm(data);
      setAppBaseline(structuredClone(data));
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveRuntime = useMutation({
    mutationFn: (patch: RuntimeConfigUpdateRequest) =>
      api<RuntimeConfigPutResponse>("/api/runtime-config", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
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

  const handleSaveAll = useCallback(async () => {
    try {
      if (appDirty && form) {
        await saveSettings.mutateAsync(form);
        toast.success("Application settings saved");
      }
      if (runtimeDirty && runtimeBaseline) {
        const patch: RuntimeConfigUpdateRequest = {};
        if (runtimeForm.logLevel !== runtimeBaseline.logLevel) {
          patch.logLevel = runtimeForm.logLevel;
        }
        if (runtimeForm.corsOrigin !== (runtimeBaseline.corsOrigin ?? "")) {
          patch.corsOrigin = runtimeForm.corsOrigin;
        }
        const jwt = runtimeForm.jwtSecret.trim();
        if (jwt) patch.jwtSecret = jwt;
        const enc = runtimeForm.appEncryptionKey.trim();
        if (enc) patch.appEncryptionKey = enc;
        if (Object.keys(patch).length > 0) {
          const res = await saveRuntime.mutateAsync(patch);
          setRuntimeBaseline({
            port: res.port,
            host: res.host,
            logLevel: res.logLevel,
            corsOrigin: res.corsOrigin,
            jwtSecretConfigured: res.jwtSecretConfigured,
            encryptionKeyConfigured: res.encryptionKeyConfigured,
          });
          setRuntimeForm((f) => ({
            ...f,
            jwtSecret: "",
            appEncryptionKey: "",
            logLevel: res.logLevel,
            corsOrigin: res.corsOrigin ?? "",
          }));
          void qc.invalidateQueries({ queryKey: ["runtime-config"] });
          if (res.needsRestart) {
            toast.success(
              `Runtime config saved. Restart the server for: ${res.needsRestartReasons.join(", ")}`,
              { duration: 6000 },
            );
          } else {
            toast.success("Runtime config saved");
          }
        }
      }
    } catch {
      /* toast handled in mutation */
    }
  }, [
    appDirty,
    form,
    runtimeDirty,
    runtimeBaseline,
    runtimeForm,
    saveSettings,
    saveRuntime,
    qc,
  ]);

  const handleReset = useCallback(() => {
    if (appBaseline) setForm(structuredClone(appBaseline));
    if (runtimeBaseline) {
      setRuntimeForm({
        jwtSecret: "",
        appEncryptionKey: "",
        logLevel: runtimeBaseline.logLevel,
        corsOrigin: runtimeBaseline.corsOrigin ?? "",
      });
    }
  }, [appBaseline, runtimeBaseline]);

  const saving = saveSettings.isPending || saveRuntime.isPending;

  if (settings.isPending || !settings.data) {
    return <p className="text-slate-400">Loading settings…</p>;
  }
  if (runtimeCfg.isPending || !runtimeCfg.data) {
    return <p className="text-slate-400">Loading settings…</p>;
  }
  if (!form || !runtimeBaseline) {
    return <p className="text-slate-400">Loading settings…</p>;
  }

  const logLevels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <nav
        className="flex shrink-0 flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950/80 p-3 lg:sticky lg:top-4 lg:w-52"
        aria-label="Settings sections"
      >
        <div className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          Jump to
        </div>
        <button type="button" className="btn-ghost justify-start text-left" onClick={() => scrollToSection(SECTION_IDS.application)}>
          Application defaults
        </button>
        <button type="button" className="btn-ghost justify-start text-left" onClick={() => scrollToSection(SECTION_IDS.externalIp)}>
          External IP services
        </button>
        <button type="button" className="btn-ghost justify-start text-left" onClick={() => scrollToSection(SECTION_IDS.runtime)}>
          Runtime / server
        </button>
        <button type="button" className="btn-ghost justify-start text-left" onClick={() => scrollToSection(SECTION_IDS.password)}>
          Change password
        </button>
      </nav>

      <div className="relative min-w-0 flex-1 space-y-6 pb-24">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        <section
          id={SECTION_IDS.application}
          className="card scroll-mt-6 space-y-4"
        >
          <div className="text-base font-medium">Application defaults</div>
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
                min={60}
                value={form.defaultForceIntervalSec}
                onChange={(e) =>
                  setForm({ ...form, defaultForceIntervalSec: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs text-slate-500">
                Hostnames with “use global default” inherit this (e.g. 3600 = 60 min, 7200 = 2 h).
              </p>
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
            <label className="label">Public IP detection mode</label>
            <select
              className="input"
              value={form.publicIpDetectionMode}
              onChange={(e) =>
                setForm({
                  ...form,
                  publicIpDetectionMode: e.target.value as AppSettings["publicIpDetectionMode"],
                })
              }
            >
              <option value="consensus">Consensus (parallel, require agreement)</option>
              <option value="failover">Failover (try URLs in order)</option>
            </select>
          </div>
          <div>
            <label className="label">Minimum provider agreements (consensus)</label>
            <input
              className="input"
              type="number"
              min={2}
              max={10}
              value={form.publicIpMinAgreements}
              onChange={(e) =>
                setForm({ ...form, publicIpMinAgreements: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="label">IP change history retention (days)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.ipHistoryRetentionDays}
              onChange={(e) =>
                setForm({ ...form, ipHistoryRetentionDays: Number(e.target.value) })
              }
            />
          </div>
        </section>

        <section
          id={SECTION_IDS.externalIp}
          className="card scroll-mt-6 space-y-4"
        >
          <div className="text-base font-medium">External IP detection services</div>
          <p className="text-sm text-slate-400">
            Manage upstream services used for public IP detection. Only enabled services are used by
            the detection engine.
          </p>
          <div className="space-y-3">
            {form.publicIpServices.map((svc, idx) => (
              <div key={svc.id} className="grid grid-cols-1 gap-2 rounded border border-slate-800 p-3 md:grid-cols-12">
                <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={svc.enabled}
                    onChange={(e) =>
                      updateIpService(form, setForm, idx, { enabled: e.target.checked })
                    }
                  />
                  Enabled
                </label>
                <input
                  className="input md:col-span-3"
                  placeholder="Service name"
                  value={svc.name}
                  onChange={(e) =>
                    updateIpService(form, setForm, idx, { name: e.target.value })
                  }
                />
                <input
                  className="input md:col-span-6"
                  placeholder="https://example.com/ip"
                  value={svc.url}
                  onChange={(e) =>
                    updateIpService(form, setForm, idx, { url: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="btn-danger md:col-span-1"
                  onClick={() =>
                    setForm({
                      ...form,
                      publicIpServices: form.publicIpServices.filter((_, i) => i !== idx),
                    })
                  }
                  disabled={form.publicIpServices.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                setForm({
                  ...form,
                  publicIpServices: [...form.publicIpServices, createIpServiceDraft(form.publicIpServices.length)],
                })
              }
            >
              Add service
            </button>
          </div>
        </section>

        <section id={SECTION_IDS.runtime} className="card scroll-mt-6 space-y-4">
          <div className="text-base font-medium">Runtime / server</div>
          <p className="text-sm text-slate-400">
            Values are merged into <code className="text-slate-300">runtime-config.json</code> and override{" "}
            <code className="text-slate-300">.env</code> after restart for some fields. Secrets are never shown after save.
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label">PORT (read-only)</label>
              <input className="input bg-slate-900/50" readOnly value={runtimeCfg.data.port} />
            </div>
            <div>
              <label className="label">HOST (read-only)</label>
              <input className="input bg-slate-900/50" readOnly value={runtimeCfg.data.host} />
            </div>
          </div>

          <div>
            <label className="label">LOG_LEVEL</label>
            <select
              className="input"
              value={runtimeForm.logLevel}
              onChange={(e) =>
                setRuntimeForm((f) => ({
                  ...f,
                  logLevel: e.target.value as (typeof logLevels)[number],
                }))
              }
            >
              {logLevels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">CORS_ORIGIN</label>
            <input
              className="input"
              placeholder="Comma-separated origins, empty for same-origin"
              value={runtimeForm.corsOrigin}
              onChange={(e) => setRuntimeForm((f) => ({ ...f, corsOrigin: e.target.value }))}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="label mb-0">JWT secret</label>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() =>
                  setRuntimeForm((f) => ({ ...f, jwtSecret: randomHex(48) }))
                }
              >
                Generate
              </button>
            </div>
            <input
              className="input font-mono text-sm"
              type="password"
              autoComplete="new-password"
              placeholder={
                runtimeCfg.data.jwtSecretConfigured
                  ? "Leave blank to keep current; or paste / generate a new secret"
                  : "Set a secret (min 16 chars)"
              }
              value={runtimeForm.jwtSecret}
              onChange={(e) => setRuntimeForm((f) => ({ ...f, jwtSecret: e.target.value }))}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="label mb-0">APP_ENCRYPTION_KEY (64 hex chars)</label>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() =>
                  setRuntimeForm((f) => ({ ...f, appEncryptionKey: randomHex(32) }))
                }
              >
                Generate
              </button>
            </div>
            <input
              className="input font-mono text-sm"
              type="password"
              autoComplete="new-password"
              placeholder={
                runtimeCfg.data.encryptionKeyConfigured
                  ? "Leave blank to keep current; or paste / generate"
                  : "64 hex characters"
              }
              value={runtimeForm.appEncryptionKey}
              onChange={(e) =>
                setRuntimeForm((f) => ({ ...f, appEncryptionKey: e.target.value }))
              }
            />
          </div>
        </section>

        <ChangePassword
          id={SECTION_IDS.password}
          onChange={(current, next) => password.mutate({ current, next })}
          busy={password.isPending}
        />

        <div
          className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-2 py-3 backdrop-blur-sm supports-[backdrop-filter]:bg-slate-950/80"
        >
          <button
            type="button"
            className="btn-ghost"
            disabled={!dirty || saving}
            onClick={handleReset}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty || saving}
            onClick={() => void handleSaveAll()}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangePassword({
  id,
  onChange,
  busy,
}: {
  id: string;
  onChange: (current: string, next: string) => void;
  busy: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <section id={id} className="card scroll-mt-6 space-y-3">
      <div className="text-base font-medium">Change admin password</div>
      <p className="text-sm text-slate-400">
        Password changes apply immediately and are not part of Save / Reset above.
      </p>
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
    </section>
  );
}

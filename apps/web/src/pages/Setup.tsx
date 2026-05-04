import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, setToken } from "../lib/api.js";

export function SetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ token: string; user: { username: string } }>(
        "/api/auth/setup",
        {
          method: "POST",
          auth: false,
          body: JSON.stringify({ username, password }),
        },
      );
      setToken(res.token);
      await qc.invalidateQueries({ queryKey: ["setup-status"] });
      toast.success("Account created");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-8 shadow-xl"
      >
        <div className="mb-2">
          <h1 className="text-xl font-semibold tracking-tight">First-time setup</h1>
          <p className="mt-1 text-sm text-slate-400">
            Create the initial admin account.
          </p>
        </div>
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}

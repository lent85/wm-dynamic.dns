import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api, setToken } from "../lib/api.js";

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ token: string; user: { username: string } }>(
        "/api/auth/login",
        {
          method: "POST",
          auth: false,
          body: JSON.stringify({ username, password }),
        },
      );
      setToken(res.token);
      toast.success(`Welcome back, ${res.user.username}`);
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-8 shadow-xl"
      >
        <div className="mb-2">
          <div className="text-xs uppercase tracking-widest text-slate-500">wm</div>
          <h1 className="text-xl font-semibold tracking-tight">dynamic-dns</h1>
          <p className="mt-1 text-sm text-slate-400">Admin sign in</p>
        </div>
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

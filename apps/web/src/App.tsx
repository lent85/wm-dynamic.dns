import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, getToken } from "./lib/api.js";
import { Layout } from "./components/Layout.js";
import { LoginPage } from "./pages/Login.js";
import { SetupPage } from "./pages/Setup.js";
import { DashboardPage } from "./pages/Dashboard.js";
import { ProvidersPage } from "./pages/Providers.js";
import { HostnamesPage } from "./pages/Hostnames.js";
import { TokensPage } from "./pages/Tokens.js";
import { LogsPage } from "./pages/Logs.js";
import { SettingsPage } from "./pages/Settings.js";

export function App() {
  const setup = useQuery({
    queryKey: ["setup-status"],
    queryFn: () =>
      api<{ needsSetup: boolean }>("/api/auth/setup-status", { auth: false }),
    staleTime: 30_000,
  });

  if (setup.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        loading…
      </div>
    );
  }

  if (setup.data?.needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/hostnames" element={<HostnamesPage />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [token, setLocalToken] = useState<string | null>(getToken());
  useEffect(() => {
    setLocalToken(getToken());
  }, [location.pathname]);
  if (!token) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

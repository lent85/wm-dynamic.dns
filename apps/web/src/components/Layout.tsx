import { NavLink, Outlet, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { setToken } from "../lib/api.js";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/hostnames", label: "Hostnames" },
  { to: "/providers", label: "Dynamic DNS Provider Service" },
  { to: "/tokens", label: "API Tokens" },
  { to: "/logs", label: "Logs" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950 px-4 py-6 lg:flex">
        <div className="mb-8 px-2">
          <div className="text-xs uppercase tracking-widest text-slate-500">wm</div>
          <div className="text-lg font-semibold tracking-tight text-slate-100">
            dynamic-dns
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-600/20 text-brand-400"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="btn-ghost mt-4 justify-start"
          onClick={() => {
            setToken(null);
            navigate("/login");
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-6 lg:p-10">
        <Outlet />
      </main>
    </div>
  );
}

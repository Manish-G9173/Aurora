import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { logout } from "../lib/api";

const NAV = [
  { path: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { path: "/interview", label: "Live Interview", icon: "M15 10l5 5-5 5M20 15H9M4 5v14" },
  { path: "/resumes", label: "Resumes", icon: "M9 2h6v3H9zM5 5h14v16H5z" },
  { path: "/reports", label: "Reports", icon: "M4 4h16v16H4zM8 14l3-3 3 3 3-4" },
];

export function Layout() {
  const { user } = useAuth();
  const loc = useLocation();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="glass m-4 flex w-64 shrink-0 flex-col p-5">
        <Link to="/" className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-violet-500 text-lg font-extrabold">
            A
          </div>
          <div>
            <div className="text-lg font-extrabold tracking-tight">AURORA</div>
            <div className="-mt-0.5 text-[11px] font-medium uppercase tracking-widest text-slate-400">
              AI Interview Coach
            </div>
          </div>
        </Link>
        <nav className="flex flex-col gap-1.5">
          {NAV.map((item) => {
            const active = loc.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-500/15 text-brand-300 shadow-inner"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto pt-6">
          <div className="glass-soft flex items-center gap-3 px-3.5 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-300">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-medium">{user?.username}</div>
              <div className="text-[11px] text-slate-500">candidate</div>
            </div>
            <button
              onClick={() => {
                logout();
                window.location.href = "/login";
              }}
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-slate-200"
              title="Sign out"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-x-hidden p-4">
        <Outlet />
      </main>
    </div>
  );
}

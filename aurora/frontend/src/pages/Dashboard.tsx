import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ApiError, DashboardData, getDashboard, startDigest } from "../lib/api";
import { useAuth } from "../lib/auth";

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function ScoreRing({ score, label, size = 96 }: { score: number; label: string; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(Math.max(score, 0), 100) / 100) * c;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={7} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#scoreGrad)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8eb7ff" />
            <stop offset="100%" stopColor="#3366ff" />
          </linearGradient>
        </defs>
      </svg>
      <div className={`-mt-[calc(${size}px+6px)] mb-2 text-xl font-extrabold`}>{score}</div>
      <div className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const { refresh } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");
  const [digesting, setDigesting] = useState(false);

  const token = localStorage.getItem("aurora_token") ?? "";

  useEffect(() => {
    getDashboard(token)
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [token]);

  async function runDigest() {
    setDigesting(true);
    setErr("");
    try {
      const res = await startDigest(token);
      setErr(`Digest queued (${res.id}) — this can take a minute.`);
      setTimeout(() => {
        getDashboard(token).then(setData);
      }, 60000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setDigesting(false);
    }
  }

  const latest = data?.sessions[0];
  const trend = (data?.overall_trend ?? []).map((t) => ({
    ...t,
    date: new Date(t.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Good to see you again</h1>
          <p className="text-sm text-slate-400">Your interview journey at a glance</p>
        </div>
        <div className="flex gap-3">
          <Link to="/interview" className="btn-primary">
            Start Interview
          </Link>
          <button className="btn-ghost" onClick={runDigest} disabled={digesting}>
            {digesting ? "Generating…" : "Run Coaching Digest"}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Overall stats */}
        <div className="glass p-6">
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Overall Progress
          </h2>
          <div className="flex items-center justify-around">
            <ScoreRing
              score={latest?.report?.overall_score ?? 0}
              label="Last score"
            />
            <ScoreRing
              score={Math.round(latest?.report?.behavioural?.eye_contact_pct ?? 0)}
              label="Eye contact %"
            />
            <ScoreRing
              score={Math.round(latest?.report?.behavioural?.posture_stability_pct ?? 0)}
              label="Posture %"
            />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="glass-soft px-4 py-3 text-center">
              <div className="text-xl font-extrabold">{data?.sessions.length ?? 0}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Sessions</div>
            </div>
            <div className="glass-soft px-4 py-3 text-center">
              <div className="text-xl font-extrabold">
                {latest ? formatDuration(latest.duration_seconds) : "—"}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Last duration</div>
            </div>
          </div>
        </div>

        {/* Trend chart */}
        <div className="glass p-6 lg:col-span-2">
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Score Trend
          </h2>
          {trend.length > 1 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5a90ff" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#5a90ff" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(15,23,42,0.95)",
                      border: "1px solid rgba(148,163,184,0.15)",
                      borderRadius: 10,
                      fontSize: 13,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="overall_score"
                    stroke="#5a90ff"
                    strokeWidth={2.5}
                    fill="url(#trendFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <div className="mb-2 text-4xl opacity-40">📈</div>
              <p className="text-sm text-slate-400">
                {trend.length === 1
                  ? "Complete one more interview to see your trend line."
                  : "No sessions yet — run your first interview to start tracking progress."}
              </p>
              <Link to="/interview" className="btn-primary mt-4">
                Start your first interview
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Recent sessions */}
      <div className="glass p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
          Recent Sessions
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="pb-3 pr-4 font-medium">Date</th>
                <th className="pb-3 pr-4 font-medium">Mode</th>
                <th className="pb-3 pr-4 font-medium">Duration</th>
                <th className="pb-3 pr-4 font-medium">Score</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.sessions ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No sessions yet.
                  </td>
                </tr>
              )}
              {data?.sessions.slice(0, 8).map((s) => (
                <tr key={s.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="py-3 pr-4 text-slate-300">
                    {new Date(s.started_at).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-semibold text-brand-300">
                      {s.mode}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-slate-300">{formatDuration(s.duration_seconds)}</td>
                  <td className="py-3 pr-4 font-semibold">{s.report?.overall_score ?? "—"}</td>
                  <td className="py-3">
                    {s.report && (
                      <Link to={`/reports/${s.id}`} className="text-xs font-semibold text-brand-400 hover:text-brand-300">
                        View report →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

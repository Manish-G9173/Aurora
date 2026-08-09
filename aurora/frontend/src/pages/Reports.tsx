import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError, Report, listReports } from "../lib/api";

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [err, setErr] = useState("");
  const token = localStorage.getItem("aurora_token") ?? "";

  useEffect(() => {
    listReports(token)
      .then(setReports)
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [token]);

  const chartData = [...reports]
    .reverse()
    .map((r, i) => ({
      name: `#${r.id}`,
      overall: r.report.overall_score,
      technical: r.report.technical_knowledge,
      communication: r.report.communication,
      confidence: r.report.confidence,
      problemSolving: r.report.problem_solving,
    }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Coaching Reports</h1>
        <p className="text-sm text-slate-400">
          Every interview generates a structured AI report — technical, communication and
          behavioural dimensions included.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {chartData.length > 0 && (
        <div className="glass p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Score Comparison (latest {chartData.length})
          </h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(148,163,184,0.15)",
                    borderRadius: 10,
                    fontSize: 13,
                  }}
                />
                <Bar dataKey="overall" fill="#5a90ff" name="Overall" radius={[4, 4, 0, 0]} />
                <Bar dataKey="technical" fill="#8b5cf6" name="Technical" radius={[4, 4, 0, 0]} />
                <Bar dataKey="communication" fill="#06b6d4" name="Communication" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.length === 0 && !err && (
          <div className="glass col-span-full p-10 text-center text-sm text-slate-500">
            No reports yet — complete an interview to generate one.
          </div>
        )}
        {reports.map((r) => (
          <Link key={r.id} to={`/reports/${r.id}`} className="glass block p-5 transition-transform hover:-translate-y-0.5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Session #{r.session_id} · {new Date(r.created_at).toLocaleDateString()}
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-400/30 to-violet-500/30 text-sm font-extrabold text-brand-300">
                {r.report.overall_score}
              </span>
            </div>
            <div className="mb-4 grid grid-cols-4 gap-1.5 text-center">
              {[
                ["Tech", r.report.technical_knowledge],
                ["Comm", r.report.communication],
                ["Conf", r.report.confidence],
                ["Solve", r.report.problem_solving],
              ].map(([l, v]) => (
                <div key={l as string} className="glass-soft px-1 py-1.5">
                  <div className="text-sm font-bold">{v}</div>
                  <div className="text-[9px] uppercase text-slate-500">{l}</div>
                </div>
              ))}
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">{r.report.verdict}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

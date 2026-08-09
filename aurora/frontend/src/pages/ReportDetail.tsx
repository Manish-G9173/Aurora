import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { ApiError, Report, getReport } from "../lib/api";

export default function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const token = localStorage.getItem("aurora_token") ?? "";

  useEffect(() => {
    if (!id) return;
    getReport(Number(id), token)
      .then(setReport)
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [id, token]);

  if (err) {
    return (
      <div className="mx-auto max-w-xl pt-10">
        <div className="glass p-6 text-center">
          <div className="mb-2 text-3xl">⚠️</div>
          <p className="text-sm text-red-300">{err}</p>
          <Link to="/reports" className="btn-ghost mt-4 inline-flex">
            Back to Reports
          </Link>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
      </div>
    );
  }

  const r = report.report;
  const radarData = [
    { subject: "Technical", value: r.technical_knowledge },
    { subject: "Communication", value: r.communication },
    { subject: "Confidence", value: r.confidence },
    { subject: "Problem Solving", value: r.problem_solving },
    { subject: "Overall", value: r.overall_score },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/reports" className="btn-ghost px-3 py-2 text-sm">
          ← All Reports
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Session #{report.session_id} Report
          </h1>
          <p className="text-xs text-slate-500">{new Date(report.created_at).toLocaleString()}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        {/* Radar + behavioural */}
        <div className="glass p-6">
          <div className="mb-2 text-center text-4xl font-extrabold text-brand-300">
            {r.overall_score}
          </div>
          <div className="mb-3 text-center text-xs uppercase tracking-widest text-slate-500">
            Overall Score
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="rgba(148,163,184,0.2)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar dataKey="value" stroke="#5a90ff" fill="#5a90ff" fillOpacity={0.35} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="glass-soft p-3 text-center">
              <div className="text-lg font-extrabold">{r.behavioural.eye_contact_pct}%</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Eye contact</div>
            </div>
            <div className="glass-soft p-3 text-center">
              <div className="text-lg font-extrabold">{r.behavioural.posture_stability_pct}%</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Posture stability</div>
            </div>
          </div>
        </div>

        {/* Narrative */}
        <div className="space-y-5">
          <div className="glass p-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-400">
              Verdict
            </h2>
            <p className="text-sm leading-relaxed text-slate-200">{r.verdict}</p>
            {r.behavioural.notes && (
              <p className="mt-3 rounded-lg bg-slate-800/50 p-3 text-sm text-slate-300">
                <span className="mr-1.5 font-semibold text-brand-300">Behaviour:</span>
                {r.behavioural.notes}
              </p>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="glass p-6">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-emerald-400/80">
                Strengths
              </h2>
              <ul className="space-y-2.5">
                {r.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-200">
                    <span className="mt-0.5 text-emerald-400">✓</span> {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="glass p-6">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-amber-400/80">
                Improvements
              </h2>
              <ul className="space-y-2.5">
                {r.improvements.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-200">
                    <span className="mt-0.5 text-amber-400">↑</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

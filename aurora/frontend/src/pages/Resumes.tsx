import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, ResumeItem, listResumes, uploadResume } from "../lib/api";

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="font-medium text-slate-300">{label}</span>
        <span className="font-semibold text-slate-400">{value}/100</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function Resumes() {
  const [resumes, setResumes] = useState<ResumeItem[]>([]);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = localStorage.getItem("aurora_token") ?? "";

  useEffect(() => {
    listResumes(token)
      .then(setResumes)
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [token]);

  async function handleFile(file: File) {
    setErr("");
    setUploading(true);
    try {
      const item = await uploadResume(file, token);
      setResumes((prev) => [item, ...prev]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Resume Analysis</h1>
        <p className="text-sm text-slate-400">
          Upload a resume and get an ATS compatibility score plus AI feedback
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {/* Upload zone */}
      <div
        className={`glass flex flex-col items-center gap-3 p-8 text-center transition-colors ${
          dragging ? "border-brand-400 bg-brand-500/10" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/15">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-300">
          Drop your resume here, or{" "}
          <button
            onClick={() => fileRef.current?.click()}
            className="font-semibold text-brand-400 hover:text-brand-300"
          >
            browse files
          </button>
        </p>
        <p className="text-xs text-slate-500">PDF up to 5 MB — Gemini parses it into structured feedback</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {uploading && (
          <div className="flex items-center gap-2 text-sm text-brand-300">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
            Parsing resume with AI… this takes a few seconds
          </div>
        )}
      </div>

      {/* Resume list */}
      <div className="grid gap-5 xl:grid-cols-2">
        {resumes.map((r) => (
          <div key={r.id} className="glass p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="truncate font-semibold">{r.filename}</div>
                <div className="text-xs text-slate-500">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400/30 to-violet-500/30 text-lg font-extrabold text-brand-300">
                {r.score.overall_score}
              </div>
            </div>

            <div className="mb-5 space-y-3">
              <Bar label="Overall" value={r.score.overall_score} color="bg-brand-500" />
              <Bar label="ATS Compatibility" value={r.score.ats_compatibility} color="bg-violet-500" />
            </div>

            {r.score.sections_found.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {r.score.sections_found.map((s) => (
                  <span key={s} className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                    {s}
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400/80">
                  Strengths
                </div>
                <ul className="space-y-1.5">
                  {r.score.strengths.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-300">
                      <span className="mt-0.5 text-emerald-400">✓</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400/80">
                  Suggestions
                </div>
                <ul className="space-y-1.5">
                  {r.score.suggestions.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-300">
                      <span className="mt-0.5 text-amber-400">↑</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-5 border-t border-slate-800 pt-4">
              <Link
                to={`/interview?resume=${r.id}`}
                className="btn-primary w-full text-sm"
              >
                Interview me on this resume →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {resumes.length === 0 && !uploading && (
        <div className="text-center text-sm text-slate-500">
          No resumes yet — upload one to see the analysis.
        </div>
      )}
    </div>
  );
}

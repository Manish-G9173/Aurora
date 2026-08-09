import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listResumes, interviewWsUrl } from "../lib/api";
import { useInterviewCV, CvState } from "../hooks/useInterviewCV";

type Msg =
  | { type: "interviewer"; text: string; model?: string; id: number }
  | { type: "candidate"; text: string; id: number }
  | { type: "system"; text: string; id: number };

let nextId = 0;

// Load MediaPipe vision tasks once, globally
function loadMediaPipe(): Promise<void> {
  if ((window as any).__visionTasks) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.js";
    script.onload = () => {
      const v = (window as any).visionTasks ?? (window as any).tasks;
      if (v) {
        (window as any).__visionTasks = v;
        resolve();
      } else reject(new Error("vision tasks not found"));
    };
    script.onerror = () => reject(new Error("media pipe failed to load"));
    document.head.appendChild(script);
  });
}

function HudGauge({ label, value, warn }: { label: string; value: number; warn: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div className={`glass-soft flex items-center gap-3 px-3.5 py-2.5 transition-colors ${warn ? "border-amber-400/60 bg-amber-500/10" : ""}`}>
      <div className="relative h-9 w-9 shrink-0">
        <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="3.5" />
          <circle
            cx="18" cy="18" r="15.5" fill="none"
            stroke={warn ? "#fbbf24" : "#5a90ff"}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${pct * 0.974} 100`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold">
          {pct}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold">{label}</div>
        <div className="text-[10px] text-slate-500">
          {warn ? "Correction needed" : "Looking good"}
        </div>
      </div>
    </div>
  );
}

export default function Interview() {
  const [params] = useSearchParams();
  const initialResume = params.get("resume");

  const [mode, setMode] = useState<"setup" | "live" | "ended">("setup");
  const [resumes, setResumes] = useState<{ id: number; filename: string }[]>([]);
  const [resumeId, setResumeId] = useState<string>(initialResume ?? "");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [err, setErr] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<Msg[]>([]);
  const cvStateRef = useRef<CvState>({ eyeContact: 0.7, posture: 0.8, lookingAway: false, slouching: false, ready: false, degraded: false });

  const cv = useInterviewCV(videoRef);
  cvStateRef.current = cv;

  useEffect(() => {
    transcriptRef.current = msgs;
  }, [msgs]);

  useEffect(() => {
    const token = localStorage.getItem("aurora_token") ?? "";
    if (token) {
      listResumes(token)
        .then((list) => setResumes(list.map((r) => ({ id: r.id, filename: r.filename }))))
        .catch(() => {});
    }
  }, [mode]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  function speakAudio(dataHex: string) {
    try {
      const bytes = new Uint8Array(dataHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
      const audioCtx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
      // Edge TTS returns mp3-like mp4/opus; decode whatever arrives
      audioCtx.decodeAudioData(bytes.buffer.slice(0))
        .then((buf) => {
          const src = audioCtx.createBufferSource();
          src.buffer = buf;
          src.connect(audioCtx.destination);
          src.start();
        })
        .catch(() => {
          // Fallback: play nothing but log. Browser can't decode raw Edge TTS opus.
          console.info("audio frame not decodable natively");
        })
        .finally(() => setAudioBusy(false));
    } catch {
      setAudioBusy(false);
    }
  }

  function sendCandidate(text: string) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
    const cv = cvStateRef.current;
    transcriptRef.current = [
      ...transcriptRef.current,
      { type: "candidate", text, id: nextId++ },
    ];
    setMsgs(transcriptRef.current);
    setInput("");
    setThinking(true);
    setAudioBusy(true);
    ws.send(
      JSON.stringify({
        type: "candidate",
        text,
        eye: cv.eyeContact,
        posture: cv.posture,
      }),
    );
  }

  function start() {
    setErr("");
    const token = localStorage.getItem("aurora_token");
    if (!token) return;
    wsRef.current?.close();

    const ws = new WebSocket(interviewWsUrl(token, resumeId ? Number(resumeId) : undefined, "practice"));
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "turn" && msg.role === "interviewer") {
        setThinking(false);
        transcriptRef.current = [
          ...transcriptRef.current,
          { type: "interviewer", text: msg.text, model: msg.model_used, id: nextId++ },
        ];
        setMsgs(transcriptRef.current);
      } else if (msg.type === "audio") {
        setAudioBusy(true);
        if (msg.data) speakAudio(msg.data);
        else setAudioBusy(false);
      } else if (msg.type === "session_ended") {
        setMode("ended");
      } else if (msg.type === "error") {
        setErr(msg.message);
      }
    };
    ws.onerror = () => setErr("WebSocket connection failed. Check your API URL.");
    ws.onclose = () => {
      if (mode !== "ended") setMode("ended");
    };
    setMode("live");
  }

  function endInterview() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end_interview" }));
    }
  }

  // Cleanup on unmount
  useEffect(() => () => wsRef.current?.close(), []);

  // ---- SETUP VIEW ----
  if (mode === "setup") {
    return (
      <div className="mx-auto max-w-2xl space-y-5 pt-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Live Interview</h1>
          <p className="text-sm text-slate-400">
            AURORA interviews you with real AI, speaks out loud, and watches your body language
            through your webcam.
          </p>
        </div>
        <div className="glass space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Base the interview on a resume (optional)
            </label>
            <select
              className="input"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
            >
              <option value="">No resume — generic technical interview</option>
              {resumes.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.filename}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
            <strong className="text-slate-200">How it works:</strong> grant camera + mic access, then
            AURORA asks questions one at a time. Type (or speak via mic) your answers. The live HUD
            tracks your eye contact and posture, and Edge TTS reads the interviewer's questions aloud.
            When you're done, get a full coaching report.
          </div>
          {err && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {err}
            </div>
          )}
          <button className="btn-primary w-full text-base" onClick={start}>
            Begin Interview
          </button>
        </div>
      </div>
    );
  }

  // ---- ENDED VIEW ----
  if (mode === "ended") {
    return (
      <div className="mx-auto max-w-xl space-y-5 pt-10 text-center">
        <div className="glass p-8">
          <div className="mb-3 text-5xl">🎉</div>
          <h1 className="text-2xl font-extrabold">Interview complete</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your session is saved. Generate your coaching report to see scores, strengths and
            improvements.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <a href="/reports" className="btn-primary">
              Open Reports
            </a>
            <button
              className="btn-ghost"
              onClick={() => {
                setMsgs([]);
                transcriptRef.current = [];
                setMode("setup");
              }}
            >
              New Interview
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- LIVE VIEW ----
  return (
    <div className="grid h-[calc(100vh-2rem)] grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
      {/* Video + HUD */}
      <div className="glass flex flex-col overflow-hidden p-4">
        <div className="relative flex-1 overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`h-full w-full scale-x-[-1] object-cover ${camOn ? "" : "hidden"}`}
          />
          {!camOn && (
            <div className="flex h-full items-center justify-center text-slate-600">
              Camera off
            </div>
          )}
          {/* HUD overlay */}
          {cv.ready && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2">
              <HudGauge label="Eye contact" value={cv.eyeContact} warn={cv.lookingAway} />
              <HudGauge label="Posture" value={cv.posture} warn={cv.slouching} />
            </div>
          )}
          {/* Corner controls */}
          <div className="absolute right-3 top-3 flex gap-2">
            <button
              onClick={() => setCamOn((v) => !v)}
              className={`rounded-full p-2.5 backdrop-blur ${camOn ? "bg-white/10 text-white" : "bg-red-500/80 text-white"}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d={camOn ? "M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z" : "M1 1l22 22M16 16V9a2 2 0 00-2-2H6.34M21 19V7a2 2 0 00-2-2h-6.34"} />
              </svg>
            </button>
            <button
              onClick={() => setMicOn((v) => !v)}
              className={`rounded-full p-2.5 backdrop-blur ${micOn ? "bg-white/10 text-white" : "bg-red-500/80 text-white"}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d={micOn ? "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" : "M19 10v2a7 7 0 01-13.2 2.4M12 19v4M8 23h8M1 1l22 22"} />
              </svg>
            </button>
          </div>
          {audioBusy && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-4 py-2 backdrop-blur">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-400" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-400 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-400 [animation-delay:300ms]" />
                <span className="ml-1 text-xs font-medium text-white">Interviewer speaking…</span>
              </div>
            </div>
          )}
          {cv.degraded && (
            <div className="absolute left-3 top-3 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300">
              Camera tracking unavailable
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Live session · Gemini {msgs[0]?.type ? "" : ""}
          </div>
          <button onClick={endInterview} className="btn-ghost border-red-500/40 text-red-300 hover:bg-red-500/10">
            End Interview
          </button>
        </div>
      </div>

      {/* Chat */}
      <div className="glass flex flex-col overflow-hidden p-4">
        <div ref={chatRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
          {msgs.map((m) =>
            m.type === "candidate" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-500/20 px-4 py-2.5 text-sm text-slate-100">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-violet-500 text-[11px] font-extrabold">
                  A
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-slate-800/70 px-4 py-2.5 text-sm leading-relaxed text-slate-100">
                  {m.text}
                  {m.type === "interviewer" && m.model && (
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                      {m.model}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {thinking && (
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-violet-500 text-[11px] font-extrabold">
                A
              </div>
              <div className="rounded-2xl rounded-bl-md bg-slate-800/70 px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                </div>
              </div>
            </div>
          )}
          {msgs.length === 0 && !thinking && (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Connecting to the AI interviewer…
            </div>
          )}
        </div>

        <form
          className="mt-3 flex gap-2 border-t border-slate-800 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            sendCandidate(input);
          }}
        >
          <input
            className="input flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={thinking ? "Waiting for the interviewer…" : "Type your answer…"}
            disabled={thinking}
          />
          <button className="btn-primary" type="submit" disabled={thinking || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

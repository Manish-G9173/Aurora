declare const __API_URL__: string;

// NOTE: we CANNOT let vite constant-fold this to "" at build time — Zerops's
// envReplace needs the literal placeholder "__API_URL__" to survive in the
// bundle. We therefore keep __API_URL__ as a runtime-visible string by
// building it dynamically (the minifier keeps dynamic expressions).
const PLACEHOLDER = "__" + "API_URL" + "__";
const BUILD_URL = __API_URL__; // "__API_URL__" placeholder or real URL from env
export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (BUILD_URL === PLACEHOLDER || !BUILD_URL ? PLACEHOLDER : BUILD_URL);

export function apiPath(path: string): string {
  return `${API_URL}${path}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<T> {
  const token = opts.token ?? localStorage.getItem("aurora_token");
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(apiPath(path), { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------
// Typed API helpers
// ------------------------------------------------------------------
export type Report = {
  id: number;
  session_id: number;
  report: {
    overall_score: number;
    technical_knowledge: number;
    communication: number;
    confidence: number;
    problem_solving: number;
    behavioural: { eye_contact_pct: number; posture_stability_pct: number; notes: string };
    strengths: string[];
    improvements: string[];
    verdict: string;
  };
  created_at: string;
};

export type SessionSummary = {
  id: number;
  mode: string;
  status: string;
  duration_seconds: number;
  started_at: string;
  report?: Report["report"] | null;
};

export type TrendPoint = {
  session_id: number;
  overall_score: number;
  eye_contact_pct: number | null;
  posture_stability_pct: number | null;
  started_at: string;
};

export type ResumeItem = {
  id: number;
  filename: string;
  score: {
    overall_score: number;
    ats_compatibility: number;
    strengths: string[];
    suggestions: string[];
    sections_found: string[];
  };
  created_at: string;
};

export type DashboardData = {
  sessions: SessionSummary[];
  overall_trend: TrendPoint[];
  latest_digest: { id: number; digest_text: string; created_at: string } | null;
};

export async function login(username: string, password: string) {
  const res = await fetch(apiPath("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Login failed");
  }
  const data = await res.json();
  localStorage.setItem("aurora_token", data.token);
  localStorage.setItem("aurora_user", data.username);
  return data as { token: string; username: string };
}

export async function register(username: string, password: string) {
  const res = await fetch(apiPath("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Registration failed");
  }
  return login(username, password);
}

export function logout() {
  localStorage.removeItem("aurora_token");
  localStorage.removeItem("aurora_user");
}

export function getMe(token: string) {
  return api<{ id: number; username: string; created_at: string }>("/api/me", { token });
}

export function getDashboard(token: string) {
  return api<DashboardData>("/api/dashboard", { token });
}

export function listResumes(token: string) {
  return api<ResumeItem[]>("/api/resumes", { token });
}

export async function uploadResume(file: File, token: string) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiPath("/api/resumes"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Upload failed");
  }
  return res.json() as Promise<ResumeItem>;
}

export function listReports(token: string, limit = 20) {
  return api<Report[]>(`/api/reports?limit=${limit}`, { token });
}

export function getReport(id: number, token: string) {
  return api<Report>(`/api/reports/${id}`, { token });
}

export function startDigest(token: string) {
  return api<{ id: number; status: string }>("/api/digest/run", {
    method: "POST",
    token,
  });
}

export function interviewWsUrl(token: string, resumeId?: number, mode = "practice"): string {
  const url = new URL(apiPath("/api/interview/ws"));
  url.searchParams.set("ws_token", token);
  url.searchParams.set("mode", mode);
  if (resumeId) url.searchParams.set("resume_id", String(resumeId));
  url.protocol = url.protocol.replace("http", "ws");
  return url.toString();
}

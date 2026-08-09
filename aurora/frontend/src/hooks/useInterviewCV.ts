/**
 * Lightweight computer-vision tracking for the interview room.
 *
 * Uses the MediaPipe Face Landmarker (webgpu/wasm) loaded from CDN to track
 * eye contact (gaze direction / blink) and head tilt as a posture proxy.
 *
 * If MediaPipe fails to load (slow network), the HUD gracefully degrades to
 * a "manual mode" and keeps scoring only the AI conversation.
 */
import { useEffect, useRef, useState } from "react";

export type CvState = {
  eyeContact: number; // 0..1 over the last window
  posture: number; // 0..1 head-stability score
  lookingAway: boolean;
  slouching: boolean;
  ready: boolean;
  degraded: boolean;
};

const LOOK_AWAY_THRESHOLD = 0.35; // normalized eye gaze offset
const TILT_THRESHOLD = 0.28; // normalized head tilt
const SAMPLE_WINDOW = 120; // ~4s at 30fps, but we sample at lower rate

type Sample = { eye: number; posture: number; looking: boolean; slouch: boolean };

export function useInterviewCV(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<CvState>({
    eyeContact: 0.7,
    posture: 0.8,
    lookingAway: false,
    slouching: false,
    ready: false,
    degraded: false,
  });
  const samplesRef = useRef<Sample[]>([]);
  const timerRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let faceDetector: any = null;

    async function start() {
      try {
        // Load MediaPipe VisionTasks from CDN
        const vision = await (window as any).__mpFaceLandmarker?.();
        const { FilesetResolver, FaceLandmarker } = (window as any).__visionTasks;
        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm",
        );
        faceDetector = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          outputFaceBlendshapes: false,
          numFaces: 1,
        });
      } catch {
        setError("Camera tracking unavailable — running in manual mode.");
        readyRef.current = true;
        setState((s) => ({ ...s, ready: true, degraded: true }));
        return;
      }

      if (cancelled) return;
      readyRef.current = true;

      let running = true;
      const loop = async () => {
        while (running && !cancelled) {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || faceDetector === null) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }
          try {
            const res = await faceDetector.detectForVideo(video, performance.now());
            const sample = computeSample(res.landmarks?.[0]);
            if (sample) samplesRef.current.push(sample);
            if (samplesRef.current.length > SAMPLE_WINDOW) {
              samplesRef.current = samplesRef.current.slice(-SAMPLE_WINDOW);
            }
            setState(buildState(samplesRef.current));
          } catch {
            // skip frame
          }
          await new Promise((r) => setTimeout(r, 150)); // ~6-7 fps tracking is plenty
        }
      };
      loop();

      timerRef.current = window.setTimeout(() => {
        running = false;
        timerRef.current = null;
      }, 0);
      (timerRef.current as unknown as { stop?: () => void }).stop = () => {
        running = false;
      };
    }

    start();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        const t = timerRef.current as unknown as { stop?: () => void };
        t.stop?.();
      }
      samplesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, error };
}

function computeSample(landmarks: any[] | undefined): Sample | null {
  if (!landmarks || landmarks.length < 68) return null;
  // MediaPipe 468-point face mesh
  const p = (i: number) => [landmarks[i].x, landmarks[i].y] as [number, number];

  // Nose tip vs face center for gaze/tilt proxy
  const nose = p(1); // nose tip
  const leftEye = p(33);
  const rightEye = p(263);
  const cx = (leftEye[0] + rightEye[0]) / 2;
  const eyeDist = Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]);
  // nose horizontal offset relative to eye distance (looking away proxy)
  const lookOffset = eyeDist > 0.001 ? Math.abs(nose[0] - cx) / eyeDist : 0;
  // chin vs forehead for tilt (slouch proxy)
  const chin = p(152);
  const brow = p(10);
  const headHeight = Math.hypot(chin[0] - brow[0], chin[1] - brow[1]);
  const verticalTilt =
    headHeight > 0.001 ? Math.abs((chin[1] + brow[1]) / 2 - 0.5) / headHeight : 0;

  const looking = lookOffset > LOOK_AWAY_THRESHOLD;
  const slouch = verticalTilt > TILT_THRESHOLD;
  return {
    eye: looking ? 0 : 1,
    posture: slouch ? 0 : 1,
    looking,
    slouch,
  };
}

function buildState(samples: Sample[]): CvState {
  if (samples.length === 0) {
    return { eyeContact: 0.7, posture: 0.8, lookingAway: false, slouching: false, ready: true, degraded: false };
  }
  const eyeAvg = samples.reduce((a, s) => a + s.eye, 0) / samples.length;
  const postureAvg = samples.reduce((a, s) => a + s.posture, 0) / samples.length;
  const recent = samples.slice(-15);
  const lookingAway = recent.some((s) => s.looking);
  const slouching = recent.some((s) => s.slouch);
  return { eyeContact: eyeAvg, posture: postureAvg, lookingAway, slouching, ready: true, degraded: false };
}

export function useCvHistory(state: CvState, max = 300) {
  const history = useRef<{ eye: number; posture: number }[]>([]);
  useEffect(() => {
    if (!state.ready || state.degraded) return;
    history.current.push({ eye: state.eyeContact, posture: state.posture });
    if (history.current.length > max) history.current.shift();
  }, [state, max]);
  return history;
}

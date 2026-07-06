import { useRef, useState, useEffect } from "react";
import { createUpload, uploadAudio } from "../lib/api";

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    ) {
      return c;
    }
  }
  return "audio/webm";
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

type State = "idle" | "recording" | "paused" | "uploading";

export function Recorder({ onUploaded }: { onUploaded: () => void }) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const mimeRef = useRef<string>("audio/webm");
  // Kept in sync with `elapsed` so the async onstop handler reads a fresh value.
  const elapsedRef = useRef(0);

  useEffect(() => {
    return () => stopTimer();
  }, []);

  const startTimer = () => {
    timerRef.current = window.setInterval(
      () =>
        setElapsed((e) => {
          elapsedRef.current = e + 1;
          return e + 1;
        }),
      1000
    );
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      mimeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start(1000);
      recorderRef.current = recorder;
      elapsedRef.current = 0;
      setElapsed(0);
      setState("recording");
      startTimer();
    } catch (e) {
      setError(
        "Microphone access denied. Please allow microphone permission and try again."
      );
    }
  };

  const pause = () => {
    recorderRef.current?.pause();
    stopTimer();
    setState("paused");
  };

  const resume = () => {
    recorderRef.current?.resume();
    startTimer();
    setState("recording");
  };

  const stop = () => {
    stopTimer();
    recorderRef.current?.stop();
    // handleStop runs asynchronously via onstop.
  };

  const handleStop = async () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const duration = elapsedRef.current;
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    if (blob.size === 0) {
      setState("idle");
      setError("Nothing was recorded.");
      return;
    }
    setState("uploading");
    try {
      const contentType = mimeRef.current.split(";")[0];
      const ticket = await createUpload({
        title: title.trim() || undefined,
        contentType,
        durationSeconds: duration,
      });
      await uploadAudio(ticket, blob);
      setTitle("");
      setElapsed(0);
      setState("idle");
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setState("idle");
    }
  };

  return (
    <div className="recorder card">
      <h3>New recording</h3>

      {error && <div className="alert error small">{error}</div>}

      <input
        className="title-input"
        placeholder="Meeting title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={state === "recording" || state === "paused"}
      />

      <div className={`timer ${state === "recording" ? "live" : ""}`}>
        {state === "recording" && <span className="rec-dot" />}
        {fmt(elapsed)}
      </div>

      <div className="recorder-controls">
        {state === "idle" && (
          <button className="btn primary block" onClick={start}>
            ● Start recording
          </button>
        )}
        {state === "recording" && (
          <>
            <button className="btn ghost" onClick={pause}>
              Pause
            </button>
            <button className="btn danger" onClick={stop}>
              ■ Stop & save
            </button>
          </>
        )}
        {state === "paused" && (
          <>
            <button className="btn ghost" onClick={resume}>
              Resume
            </button>
            <button className="btn danger" onClick={stop}>
              ■ Stop & save
            </button>
          </>
        )}
        {state === "uploading" && (
          <button className="btn primary block" disabled>
            Uploading…
          </button>
        )}
      </div>
    </div>
  );
}

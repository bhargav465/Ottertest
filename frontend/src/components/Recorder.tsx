import { useRef, useState, useEffect } from "react";
import { createUpload, uploadAudio, deleteMeeting } from "../lib/api";

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

// getDisplayMedia (tab/system audio) is desktop-Chromium only. Hide the option
// where it isn't available (iOS/Safari, most mobile) so we don't offer a
// control that can't work there.
function systemAudioSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function"
  );
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

// Guardrails: keep single recordings/imports within what the transcription
// pipeline (Lambda memory/timeout) and your Deepgram bill comfortably handle.
const MAX_RECORD_SECONDS = 3 * 60 * 60; // auto-stop after 3 hours
const MAX_IMPORT_BYTES = 200 * 1024 * 1024; // 200 MB

export function Recorder({
  onUploaded,
  folder,
}: {
  onUploaded: () => void;
  folder?: string | null;
}) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [captureSystem, setCaptureSystem] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // All raw tracks we open (mic + optional display) so we can stop them cleanly.
  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mimeRef = useRef<string>("audio/webm");
  // Kept in sync with `elapsed` so the async onstop handler reads a fresh value.
  const elapsedRef = useRef(0);

  useEffect(() => {
    return () => {
      stopTimer();
      teardownStreams();
    };
  }, []);

  const startTimer = () => {
    timerRef.current = window.setInterval(() => {
      const next = elapsedRef.current + 1;
      elapsedRef.current = next;
      setElapsed(next);
      if (next >= MAX_RECORD_SECONDS) {
        setNote("Reached the 3-hour recording limit — saving your recording now.");
        stop();
      }
    }, 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const teardownStreams = () => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    displayStreamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  /**
   * Build the stream to record. With `captureSystem`, we also grab tab/system
   * audio via getDisplayMedia and mix it with the mic through the Web Audio API
   * so remote call participants end up in the recording (and get their own
   * speaker label). Falls back to mic-only if the user cancels the share.
   */
  const buildRecordStream = async (): Promise<MediaStream> => {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = mic;

    if (!captureSystem) return mic;

    let display: MediaStream | null = null;
    try {
      // Chrome requires a video track to be requested for getDisplayMedia; we
      // never record it — only the accompanying audio track is mixed in.
      display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } catch {
      setNote(
        "Screen/tab audio was not shared — recording your microphone only."
      );
      return mic;
    }

    if (display.getAudioTracks().length === 0) {
      display.getTracks().forEach((t) => t.stop());
      setNote(
        'No tab audio captured. Tip: pick the meeting tab and tick "Share tab audio". Recording microphone only.'
      );
      return mic;
    }

    displayStreamRef.current = display;
    // If the user clicks the browser's "Stop sharing" bar, end the recording.
    display.getVideoTracks().forEach((t) => (t.onended = () => stop()));

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(mic).connect(dest);
    audioCtx.createMediaStreamSource(display).connect(dest);
    return dest.stream;
  };

  const start = async () => {
    setError(null);
    setNote(null);
    try {
      const stream = await buildRecordStream();
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
      teardownStreams();
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
    // Guard against double-stop (e.g. user click + share-ended firing together).
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    // handleStop runs asynchronously via onstop.
  };

  /** Shared upload path for both live recordings and imported files. */
  const uploadRecording = async (
    blob: Blob,
    contentType: string,
    durationSeconds: number | undefined,
    titleOverride?: string
  ) => {
    setState("uploading");
    let ticket;
    try {
      ticket = await createUpload({
        title: (titleOverride ?? title).trim() || undefined,
        contentType,
        durationSeconds,
        folder: folder || undefined,
      });
      await uploadAudio(ticket, blob);
      setTitle("");
      setElapsed(0);
      setState("idle");
      onUploaded();
    } catch (e) {
      // If the placeholder record was created but the upload failed, remove it
      // so it doesn't linger in the list stuck on "Uploading…".
      if (ticket) {
        deleteMeeting(ticket.meetingId).catch(() => {});
      }
      setError(
        e instanceof Error
          ? `${e.message}. Your recording was not saved — please try again.`
          : "Upload failed — please try again."
      );
      setState("idle");
    }
  };

  const handleStop = async () => {
    teardownStreams();
    const duration = elapsedRef.current;
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    if (blob.size === 0) {
      setState("idle");
      setError("Nothing was recorded.");
      return;
    }
    await uploadRecording(blob, mimeRef.current.split(";")[0], duration);
  };

  /** Read an audio file's duration (best-effort) so the list shows a length. */
  const readDuration = (file: File): Promise<number | undefined> =>
    new Promise((resolve) => {
      try {
        const el = document.createElement("audio");
        el.preload = "metadata";
        el.onloadedmetadata = () => {
          const d = Number.isFinite(el.duration) ? Math.round(el.duration) : undefined;
          URL.revokeObjectURL(el.src);
          resolve(d);
        };
        el.onerror = () => resolve(undefined);
        el.src = URL.createObjectURL(file);
      } catch {
        resolve(undefined);
      }
    });

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNote(null);
    if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|wav|ogg|flac|webm|mp4)$/i.test(file.name)) {
      setError("Please choose an audio file (mp3, m4a, wav, ogg, flac…).");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError(
        `That file is ${Math.round(file.size / 1024 / 1024)} MB — the limit is 200 MB. Tip: convert it to mp3/m4a to shrink it.`
      );
      return;
    }
    const contentType = file.type || "audio/mpeg";
    const duration = await readDuration(file);
    const effectiveTitle =
      title.trim() || file.name.replace(/\.[^.]+$/, "");
    await uploadRecording(file, contentType, duration, effectiveTitle);
  };

  const idle = state === "idle";

  return (
    <div className="recorder card">
      <h3>New recording</h3>

      {error && <div className="alert error small">{error}</div>}
      {note && <div className="alert info small">{note}</div>}

      <input
        className="title-input"
        placeholder="Meeting title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={state === "recording" || state === "paused"}
      />

      {systemAudioSupported() && (
        <label className="capture-toggle" title="Only for live Zoom/Meet/Teams calls">
          <input
            type="checkbox"
            checked={captureSystem}
            disabled={!idle}
            onChange={(e) => setCaptureSystem(e.target.checked)}
          />
          <span>
            Capture call audio
            <span className="muted small">
              {" "}
              — only for live video calls. Records a browser tab you pick, so
              anything playing in it (a video, music) gets recorded instead of
              your voice.
            </span>
          </span>
        </label>
      )}

      {idle && folder && (
        <p className="muted small folder-hint">
          📁 Saves to <strong>{folder}</strong>
        </p>
      )}

      <div className={`timer ${state === "recording" ? "live" : ""}`}>
        {state === "recording" && <span className="rec-dot" />}
        {fmt(elapsed)}
      </div>

      {state === "recording" && (
        <div className="equalizer" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.09}s` }} />
          ))}
        </div>
      )}

      <div className="recorder-controls">
        {idle && (
          <button className="btn primary block" onClick={start}>
            ● Start recording
          </button>
        )}
        {idle && (
          <button
            className="btn ghost"
            onClick={() => fileInputRef.current?.click()}
            title="Transcribe an existing audio file"
          >
            ⬆ Import file
          </button>
        )}
        {state === "recording" && (
          <>
            <button className="btn ghost" onClick={pause}>
              Pause
            </button>
            <button className="btn danger" onClick={stop}>
              ■ Stop &amp; save
            </button>
          </>
        )}
        {state === "paused" && (
          <>
            <button className="btn ghost" onClick={resume}>
              Resume
            </button>
            <button className="btn danger" onClick={stop}>
              ■ Stop &amp; save
            </button>
          </>
        )}
        {state === "uploading" && (
          <button className="btn primary block" disabled>
            Uploading…
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm,.mp4"
        style={{ display: "none" }}
        onChange={(e) => {
          importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {idle && captureSystem && (
        <div className="alert warn small capture-hint">
          ⚠️ When you press start, your browser asks which tab/window to share —
          pick your <strong>live meeting</strong> tab and tick{" "}
          <strong>“Also share tab audio”</strong>. Whatever plays in that tab is
          recorded, so close any videos or music first.
        </div>
      )}
    </div>
  );
}

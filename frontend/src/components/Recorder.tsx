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

export function Recorder({ onUploaded }: { onUploaded: () => void }) {
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

  const handleStop = async () => {
    teardownStreams();
    const duration = elapsedRef.current;
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    if (blob.size === 0) {
      setState("idle");
      setError("Nothing was recorded.");
      return;
    }
    setState("uploading");
    const contentType = mimeRef.current.split(";")[0];
    let ticket;
    try {
      ticket = await createUpload({
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
        <label className="capture-toggle" title="Great for Zoom/Meet/Teams calls">
          <input
            type="checkbox"
            checked={captureSystem}
            disabled={!idle}
            onChange={(e) => setCaptureSystem(e.target.checked)}
          />
          <span>
            Capture call audio
            <span className="muted small"> — record remote participants too</span>
          </span>
        </label>
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

      {idle && captureSystem && (
        <p className="muted small capture-hint">
          When you start, pick the meeting tab/window and enable “Share tab
          audio”.
        </p>
      )}
    </div>
  );
}

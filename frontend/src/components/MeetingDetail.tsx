import { useEffect, useState, useCallback, useMemo } from "react";
import {
  getMeeting,
  deleteMeeting,
  updateMeeting,
  getAudioUrl,
  type Meeting,
} from "../lib/api";
import { meetingToMarkdown, downloadText, slugify } from "../lib/exportMeeting";

const NEW_FOLDER = "__new__";

export function MeetingDetail({
  meetingId,
  folders,
  onUpdated,
  onDeleted,
}: {
  meetingId: string;
  folders: string[];
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [folderSaving, setFolderSaving] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [savingSpeakers, setSavingSpeakers] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await getMeeting(meetingId);
      setMeeting(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meeting");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    setLoading(true);
    setTab("summary");
    load();
  }, [load]);

  // Keep polling until processing finishes.
  useEffect(() => {
    if (!meeting) return;
    if (meeting.status === "DONE" || meeting.status === "FAILED") return;
    const id = window.setInterval(load, 5000);
    return () => clearInterval(id);
  }, [meeting, load]);

  // Existing folders plus this meeting's own (in case it's brand new).
  const folderOptions = useMemo(() => {
    const set = new Set(folders);
    if (meeting?.folder) set.add(meeting.folder);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [folders, meeting?.folder]);

  // Distinct "Speaker N" labels present in the transcript, in order.
  const speakerLabels = useMemo(() => {
    const set = new Set<string>();
    const re = /^(Speaker \d+):/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(meeting?.transcript ?? "")) !== null) set.add(m[1]);
    return Array.from(set).sort(
      (a, b) => parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10)
    );
  }, [meeting?.transcript]);

  // Seed the editable name map from the saved names whenever they change.
  const savedNamesKey = JSON.stringify(meeting?.speakerNames ?? {});
  useEffect(() => {
    setNames(meeting?.speakerNames ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, savedNamesKey]);

  const saveSpeakers = async () => {
    setSavingSpeakers(true);
    setError(null);
    try {
      const updated = await updateMeeting(meetingId, { speakerNames: names });
      setMeeting(updated);
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save speaker names");
    } finally {
      setSavingSpeakers(false);
    }
  };

  // Transcript rendered with saved speaker names substituted in.
  const renderedTranscript = useMemo(() => {
    const t = meeting?.transcript ?? "";
    if (!t.trim()) return null;
    const map = meeting?.speakerNames ?? {};
    return t.split("\n").map((line, i) => {
      const m = line.match(/^(Speaker \d+): ?(.*)$/);
      if (m) {
        return (
          <p key={i} className="tline">
            <span className="spk">{map[m[1]] || m[1]}:</span> {m[2]}
          </p>
        );
      }
      return (
        <p key={i} className="tline">
          {line}
        </p>
      );
    });
  }, [meeting?.transcript, meeting?.speakerNames]);

  const applyFolder = async (folder: string) => {
    setFolderSaving(true);
    setError(null);
    try {
      const updated = await updateMeeting(meetingId, { folder });
      setMeeting(updated);
      setCreatingFolder(false);
      setNewFolder("");
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update folder");
    } finally {
      setFolderSaving(false);
    }
  };

  // Fetch a playback URL once the recording exists (i.e. past the upload step).
  useEffect(() => {
    setAudioUrl(null);
    if (!meeting || meeting.status === "UPLOADING") return;
    let cancelled = false;
    getAudioUrl(meetingId)
      .then((url) => {
        if (!cancelled) setAudioUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, meeting?.status]);

  const handleCopy = async () => {
    if (!meeting) return;
    try {
      await navigator.clipboard.writeText(meetingToMarkdown(meeting));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy to clipboard.");
    }
  };

  const handleDownload = () => {
    if (!meeting) return;
    downloadText(`${slugify(meeting.title)}.md`, meetingToMarkdown(meeting));
  };

  const handleShare = async () => {
    if (!meeting) return;
    const text = meetingToMarkdown(meeting);
    if (navigator.share) {
      try {
        await navigator.share({ title: meeting.title, text });
      } catch {
        /* user dismissed the share sheet */
      }
    } else {
      handleCopy();
    }
  };

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleDelete = async () => {
    if (!confirm("Delete this meeting and its recording? This cannot be undone."))
      return;
    try {
      await deleteMeeting(meetingId);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading) return <div className="center muted">Loading meeting…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!meeting) return null;

  const processing =
    meeting.status === "UPLOADING" ||
    meeting.status === "TRANSCRIBING" ||
    meeting.status === "SUMMARIZING";

  return (
    <div className="detail">
      <div className="detail-header">
        <div>
          <h1>{meeting.title}</h1>
          <p className="muted small">
            {new Date(meeting.createdAt).toLocaleString()}
            {meeting.durationSeconds
              ? ` · ${Math.round(meeting.durationSeconds / 60)} min`
              : ""}
          </p>
        </div>
        <div className="detail-actions">
          <button className="btn ghost btn-sm" onClick={handleCopy}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button className="btn ghost btn-sm" onClick={handleDownload}>
            Download
          </button>
          {canShare && (
            <button className="btn ghost btn-sm" onClick={handleShare}>
              Share
            </button>
          )}
          <button className="btn danger ghost btn-sm" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      {audioUrl && (
        <audio className="audio-player" controls preload="none" src={audioUrl}>
          Your browser can't play this recording.
        </audio>
      )}

      <div className="folder-row">
        <span className="folder-label">📁 Folder</span>
        {creatingFolder ? (
          <span className="folder-new">
            <input
              className="folder-input"
              autoFocus
              placeholder="New folder name"
              value={newFolder}
              maxLength={60}
              disabled={folderSaving}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFolder.trim())
                  applyFolder(newFolder.trim());
                if (e.key === "Escape") {
                  setCreatingFolder(false);
                  setNewFolder("");
                }
              }}
            />
            <button
              className="btn primary btn-sm"
              disabled={!newFolder.trim() || folderSaving}
              onClick={() => applyFolder(newFolder.trim())}
            >
              Save
            </button>
            <button
              className="btn ghost btn-sm"
              disabled={folderSaving}
              onClick={() => {
                setCreatingFolder(false);
                setNewFolder("");
              }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <select
            className="folder-select"
            value={meeting.folder ?? ""}
            disabled={folderSaving}
            onChange={(e) => {
              const v = e.target.value;
              if (v === NEW_FOLDER) setCreatingFolder(true);
              else applyFolder(v);
            }}
          >
            <option value="">Unfiled</option>
            {folderOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value={NEW_FOLDER}>＋ New folder…</option>
          </select>
        )}
        {folderSaving && <span className="spinner" />}
      </div>

      {processing && (
        <div className="processing-banner">
          <span className="spinner" />
          {meeting.status === "UPLOADING" && "Uploading audio…"}
          {meeting.status === "TRANSCRIBING" &&
            "Transcribing your meeting…"}
          {meeting.status === "SUMMARIZING" &&
            "Summarizing and extracting action items…"}
        </div>
      )}

      {meeting.status === "FAILED" && (
        <div className="alert error">
          {meeting.error || "Something went wrong processing this meeting."}
        </div>
      )}

      {meeting.status === "DONE" && (
        <>
          <div className="tabs">
            <button
              className={tab === "summary" ? "tab active" : "tab"}
              onClick={() => setTab("summary")}
            >
              Summary & actions
            </button>
            <button
              className={tab === "transcript" ? "tab active" : "tab"}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
          </div>

          {tab === "summary" && !meeting.summary && (
            <div className="alert info">
              AI summary and action items are turned off for this instance. Your
              recording is safely stored and transcribed — open the{" "}
              <button className="btn link" onClick={() => setTab("transcript")}>
                Transcript
              </button>{" "}
              tab to read it. Set a GROQ_API_KEY to get automatic summaries.
            </div>
          )}

          {tab === "summary" && meeting.summary && (
            <div className="summary">
              <section>
                <h3>TL;DR</h3>
                <p>{meeting.summary.tldr}</p>
              </section>

              {meeting.summary.actionItems.length > 0 && (
                <section>
                  <h3>Action items</h3>
                  <ul className="action-items">
                    {[...meeting.summary.actionItems]
                      .sort((a, b) => Number(b.mine) - Number(a.mine))
                      .map((a, i) => (
                        <li key={i} className={a.mine ? "mine" : ""}>
                          <span className="check">
                            {a.mine ? "⭐" : "▫️"}
                          </span>
                          <div>
                            <div className="task">{a.task}</div>
                            <div className="muted small">
                              {a.mine ? "You" : a.owner}
                              {a.due ? ` · due ${a.due}` : ""}
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>
                </section>
              )}

              {meeting.summary.keyPoints.length > 0 && (
                <section>
                  <h3>Key points</h3>
                  <ul className="bullets">
                    {meeting.summary.keyPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </section>
              )}

              {meeting.summary.decisions.length > 0 && (
                <section>
                  <h3>Decisions</h3>
                  <ul className="bullets">
                    {meeting.summary.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {tab === "transcript" && (
            <>
              {speakerLabels.length > 0 && (
                <div className="speaker-editor">
                  <div className="speaker-editor-head">
                    <span>🏷️ Name the speakers</span>
                    {savingSpeakers ? (
                      <span className="spinner" />
                    ) : (
                      <button
                        className="btn primary btn-sm"
                        onClick={saveSpeakers}
                      >
                        Save names
                      </button>
                    )}
                  </div>
                  <div className="speaker-grid">
                    {speakerLabels.map((label) => (
                      <label key={label} className="speaker-item">
                        <span className="muted small">{label}</span>
                        <input
                          className="folder-input"
                          placeholder={label}
                          maxLength={60}
                          value={names[label] ?? ""}
                          disabled={savingSpeakers}
                          onChange={(e) =>
                            setNames((n) => ({ ...n, [label]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveSpeakers();
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="muted small speaker-hint">
                    Leave blank to keep “Speaker 1”, “Speaker 2”, …
                  </p>
                </div>
              )}

              <div className="transcript">
                {renderedTranscript || "No transcript available."}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

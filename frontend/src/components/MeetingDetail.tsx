import { useEffect, useState, useCallback } from "react";
import {
  getMeeting,
  deleteMeeting,
  type Meeting,
} from "../lib/api";

export function MeetingDetail({
  meetingId,
  onDeleted,
}: {
  meetingId: string;
  onDeleted: () => void;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");

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
        <button className="btn danger ghost" onClick={handleDelete}>
          Delete
        </button>
      </div>

      {processing && (
        <div className="processing-banner">
          <span className="spinner" />
          {meeting.status === "UPLOADING" && "Uploading audio…"}
          {meeting.status === "TRANSCRIBING" &&
            "Transcribing your meeting with Amazon Transcribe…"}
          {meeting.status === "SUMMARIZING" &&
            "Summarizing with Amazon Bedrock…"}
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
            <pre className="transcript">
              {meeting.transcript || "No transcript available."}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

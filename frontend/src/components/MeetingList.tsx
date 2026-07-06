import { useEffect, useState, useCallback } from "react";
import { listMeetings, type MeetingListItem, type MeetingStatus } from "../lib/api";

const STATUS_LABEL: Record<MeetingStatus, string> = {
  UPLOADING: "Uploading",
  TRANSCRIBING: "Transcribing",
  SUMMARIZING: "Summarizing",
  DONE: "Ready",
  FAILED: "Failed",
};

function StatusBadge({ status }: { status: MeetingStatus }) {
  const inProgress =
    status === "UPLOADING" ||
    status === "TRANSCRIBING" ||
    status === "SUMMARIZING";
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      {inProgress && <span className="spinner" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MeetingList({
  refreshKey,
  selectedId,
  onSelect,
}: {
  refreshKey: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await listMeetings();
      setMeetings(items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meetings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Poll while anything is still processing so the UI updates itself.
  useEffect(() => {
    const anyInProgress = meetings.some(
      (m) => m.status !== "DONE" && m.status !== "FAILED"
    );
    if (!anyInProgress) return;
    const id = window.setInterval(load, 5000);
    return () => clearInterval(id);
  }, [meetings, load]);

  return (
    <div className="meeting-list">
      <div className="list-header">
        <h3>Meetings</h3>
        <button className="btn link" onClick={load} title="Refresh">
          ↻
        </button>
      </div>

      {loading && <div className="muted small">Loading…</div>}
      {error && <div className="alert error small">{error}</div>}
      {!loading && meetings.length === 0 && (
        <div className="muted small">No meetings yet — record your first one.</div>
      )}

      <ul>
        {meetings.map((m) => (
          <li
            key={m.meetingId}
            className={m.meetingId === selectedId ? "selected" : ""}
            onClick={() => onSelect(m.meetingId)}
          >
            <div className="row1">
              <span className="mtitle">{m.title}</span>
              <StatusBadge status={m.status} />
            </div>
            <div className="row2 muted small">
              <span>{new Date(m.createdAt).toLocaleString()}</span>
              {m.myActionItemCount > 0 && (
                <span className="my-actions">
                  ✅ {m.myActionItemCount} for you
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

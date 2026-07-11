import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { listMeetings, type MeetingListItem, type MeetingStatus } from "../lib/api";

const STATUS_LABEL: Record<MeetingStatus, string> = {
  UPLOADING: "Uploading",
  TRANSCRIBING: "Transcribing",
  SUMMARIZING: "Summarizing",
  DONE: "Ready",
  FAILED: "Failed",
};

// activeFolder sentinels: null = All folders, "" = Unfiled, else a folder name.
export const UNFILED = "";

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
  activeFolder,
  onFolderChange,
  onFoldersChange,
}: {
  refreshKey: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  activeFolder: string | null;
  onFolderChange: (folder: string | null) => void;
  onFoldersChange: (folders: string[]) => void;
}) {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const m of meetings) if (m.folder) set.add(m.folder);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [meetings]);

  const hasUnfiled = useMemo(() => meetings.some((m) => !m.folder), [meetings]);

  // Publish the folder list to the parent (for the detail view's picker).
  const lastFolders = useRef("");
  useEffect(() => {
    const key = folders.join("|");
    if (key !== lastFolders.current) {
      lastFolders.current = key;
      onFoldersChange(folders);
    }
  }, [folders, onFoldersChange]);

  const visible = useMemo(() => {
    let list = meetings;
    if (activeFolder === UNFILED) list = list.filter((m) => !m.folder);
    else if (activeFolder !== null)
      list = list.filter((m) => m.folder === activeFolder);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.tldr ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [meetings, activeFolder, query]);

  const showFolderTags = activeFolder === null;

  return (
    <div className="meeting-list">
      <div className="list-header">
        <h3>Meetings</h3>
        <button className="btn link" onClick={load} title="Refresh">
          ↻
        </button>
      </div>

      {meetings.length > 3 && (
        <input
          className="search-input"
          type="search"
          placeholder="Search meetings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {(folders.length > 0 || hasUnfiled) && (
        <div className="folder-filter">
          <button
            className={`chip ${activeFolder === null ? "active" : ""}`}
            onClick={() => onFolderChange(null)}
          >
            All
          </button>
          {folders.map((f) => (
            <button
              key={f}
              className={`chip ${activeFolder === f ? "active" : ""}`}
              onClick={() => onFolderChange(f)}
            >
              📁 {f}
            </button>
          ))}
          {hasUnfiled && (
            <button
              className={`chip ${activeFolder === UNFILED ? "active" : ""}`}
              onClick={() => onFolderChange(UNFILED)}
            >
              Unfiled
            </button>
          )}
        </div>
      )}

      {loading && <div className="muted small">Loading…</div>}
      {error && <div className="alert error small">{error}</div>}
      {!loading && meetings.length === 0 && (
        <div className="muted small">No meetings yet — record your first one.</div>
      )}
      {!loading && meetings.length > 0 && visible.length === 0 && (
        <div className="muted small">
          {query.trim() ? "No meetings match your search." : "No meetings in this folder yet."}
        </div>
      )}

      <ul>
        {visible.map((m) => (
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
            {showFolderTags && m.folder && (
              <div className="folder-tag">📁 {m.folder}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

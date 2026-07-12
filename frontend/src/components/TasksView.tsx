import { useEffect, useState, useCallback, useMemo } from "react";
import {
  listMeetings,
  updateMeeting,
  type MeetingListItem,
} from "../lib/api";

type Filter = "mine" | "all";

/**
 * Cross-meeting action-items dashboard: every actionable from every meeting in
 * one place, with persistent done-checkboxes. "Mine" shows the items assigned
 * to the account owner.
 */
export function TasksView({
  refreshKey,
  onOpenMeeting,
}: {
  refreshKey: number;
  onOpenMeeting: (id: string) => void;
}) {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("mine");
  const [hideDone, setHideDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const items = await listMeetings();
      setMeetings(items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load action items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const groups = useMemo(() => {
    return meetings
      .map((m) => {
        const done = new Set(m.actionItemsDone ?? []);
        const items = (m.actionItems ?? [])
          .map((a, i) => ({ ...a, idx: i, done: done.has(i) }))
          .filter((a) => (filter === "mine" ? a.mine : true))
          .filter((a) => (hideDone ? !a.done : true));
        return { meeting: m, items };
      })
      .filter((g) => g.items.length > 0);
  }, [meetings, filter, hideDone]);

  const totals = useMemo(() => {
    let open = 0;
    let done = 0;
    for (const m of meetings) {
      const doneSet = new Set(m.actionItemsDone ?? []);
      for (const [i, a] of (m.actionItems ?? []).entries()) {
        if (filter === "mine" && !a.mine) continue;
        if (doneSet.has(i)) done += 1;
        else open += 1;
      }
    }
    return { open, done };
  }, [meetings, filter]);

  const toggle = async (m: MeetingListItem, idx: number) => {
    const current = new Set(m.actionItemsDone ?? []);
    if (current.has(idx)) current.delete(idx);
    else current.add(idx);
    const next = Array.from(current).sort((a, b) => a - b);
    // Optimistic update so checkboxes feel instant.
    setMeetings((list) =>
      list.map((x) =>
        x.meetingId === m.meetingId ? { ...x, actionItemsDone: next } : x
      )
    );
    try {
      await updateMeeting(m.meetingId, { actionItemsDone: next });
    } catch {
      load(); // roll back to server truth
    }
  };

  return (
    <div className="tasks-view">
      <div className="tasks-header">
        <div>
          <h1>✅ Action items</h1>
          <p className="muted small">
            {totals.open} open · {totals.done} done
            {filter === "mine" ? " · assigned to you" : " · everyone"}
          </p>
        </div>
        <div className="tasks-filters">
          <button
            className={`chip ${filter === "mine" ? "active" : ""}`}
            onClick={() => setFilter("mine")}
          >
            ⭐ Mine
          </button>
          <button
            className={`chip ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            Everyone
          </button>
          <button
            className={`chip ${hideDone ? "active" : ""}`}
            onClick={() => setHideDone((h) => !h)}
          >
            Hide done
          </button>
        </div>
      </div>

      {loading && <div className="muted small">Loading…</div>}
      {error && <div className="alert error small">{error}</div>}

      {!loading && groups.length === 0 && (
        <div className="empty-state">
          <div className="empty-emoji">🎉</div>
          <h2>Nothing here</h2>
          <p className="muted">
            {filter === "mine"
              ? "No open action items assigned to you. Record a meeting and they'll be pulled out automatically."
              : "No action items yet — record a meeting and they'll be pulled out automatically."}
          </p>
        </div>
      )}

      {groups.map(({ meeting, items }) => (
        <section key={meeting.meetingId} className="task-group">
          <h3>
            <button
              className="btn link task-meeting-link"
              onClick={() => onOpenMeeting(meeting.meetingId)}
            >
              {meeting.title}
            </button>
            <span className="muted small">
              {" "}
              · {new Date(meeting.createdAt).toLocaleDateString()}
            </span>
          </h3>
          <ul className="action-items">
            {items.map((a) => (
              <li
                key={a.idx}
                className={`${a.mine ? "mine" : ""} ${a.done ? "done" : ""}`}
              >
                <input
                  type="checkbox"
                  className="ai-check"
                  checked={a.done}
                  onChange={() => toggle(meeting, a.idx)}
                  title={a.done ? "Mark as open" : "Mark as done"}
                />
                <div>
                  <div className="task">{a.task}</div>
                  <div className="muted small">
                    {a.mine ? "⭐ You" : a.owner}
                    {a.due ? ` · due ${a.due}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

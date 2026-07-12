import { useEffect, useState, useCallback } from "react";
import { getCurrentUser, signOut, type AuthUser } from "./lib/auth";
import { AuthPanel } from "./components/AuthPanel";
import { Recorder } from "./components/Recorder";
import { MeetingList } from "./components/MeetingList";
import { MeetingDetail } from "./components/MeetingDetail";
import { TasksView } from "./components/TasksView";
import { AccountMenu } from "./components/AccountMenu";

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const openMeeting = useCallback((id: string) => {
    setShowTasks(false);
    setSelectedId(id);
  }, []);

  const handleSignOut = () => {
    signOut();
    setUser(null);
    setSelectedId(null);
    setShowTasks(false);
  };

  if (loading) {
    return <div className="center muted">Loading…</div>;
  }

  if (!user) {
    return <AuthPanel onAuthenticated={(u) => setUser(u)} />;
  }

  // On mobile the content pane takes over the screen whenever something is open.
  const contentOpen = selectedId !== null || showTasks;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🦦</span>
          <span>Ottertest</span>
        </div>
        <div className="user-menu">
          <button
            className={`btn ghost btn-sm ${showTasks ? "active-nav" : ""}`}
            onClick={() => {
              setSelectedId(null);
              setShowTasks((t) => !t);
            }}
          >
            ✅ Tasks
          </button>
          <AccountMenu user={user} onSignOut={handleSignOut} />
        </div>
      </header>

      <main className={`layout ${contentOpen ? "has-selection" : ""}`}>
        <aside className="sidebar">
          <Recorder
            folder={activeFolder}
            onUploaded={() => {
              refresh();
            }}
          />
          <MeetingList
            refreshKey={refreshKey}
            selectedId={selectedId}
            onSelect={openMeeting}
            activeFolder={activeFolder}
            onFolderChange={setActiveFolder}
            onFoldersChange={setFolders}
          />
        </aside>

        <section className="content">
          {showTasks ? (
            <>
              <button
                className="btn ghost mobile-back"
                onClick={() => setShowTasks(false)}
              >
                ← All meetings
              </button>
              <TasksView refreshKey={refreshKey} onOpenMeeting={openMeeting} />
            </>
          ) : selectedId ? (
            <>
              <button
                className="btn ghost mobile-back"
                onClick={() => setSelectedId(null)}
              >
                ← All meetings
              </button>
              <MeetingDetail
                meetingId={selectedId}
                folders={folders}
                onUpdated={refresh}
                onDeleted={() => {
                  setSelectedId(null);
                  refresh();
                }}
              />
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-emoji">🎙️</div>
              <h2>Record or select a meeting</h2>
              <p className="muted">
                Hit record to capture a meeting. Ottertest transcribes it, writes
                a summary, and pulls out your action items automatically.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

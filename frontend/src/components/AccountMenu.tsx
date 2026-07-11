import { useState } from "react";
import { exportAccount, deleteAccountData } from "../lib/api";
import { deleteCurrentUser, type AuthUser } from "../lib/auth";

export function AccountMenu({
  user,
  onSignOut,
}: {
  user: AuthUser;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy("export");
    try {
      const data = await exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ottertest-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "Permanently delete your account and ALL of your meetings and recordings? This cannot be undone."
      )
    )
      return;
    if (prompt('Type "DELETE" to confirm.') !== "DELETE") return;
    setBusy("delete");
    try {
      await deleteAccountData(); // wipe meetings + audio server-side
      await deleteCurrentUser().catch(() => {}); // remove the Cognito account
      alert("Your account and all data have been deleted.");
      onSignOut();
    } catch (e) {
      alert(`Could not delete account: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="account-menu">
      <button
        className="btn ghost account-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="muted">{user.email}</span> ▾
      </button>
      {open && (
        <>
          <div className="account-backdrop" onClick={() => setOpen(false)} />
          <div className="account-dropdown">
            <button
              className="account-item"
              disabled={busy !== null}
              onClick={handleExport}
            >
              {busy === "export" ? "Exporting…" : "⬇ Export my data"}
            </button>
            <button
              className="account-item"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
            <div className="account-sep" />
            <button
              className="account-item danger"
              disabled={busy !== null}
              onClick={handleDelete}
            >
              {busy === "delete" ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

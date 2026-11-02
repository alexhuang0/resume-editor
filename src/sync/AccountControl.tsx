import { useEffect, useState } from "react";
import { isSyncConfigured } from "./supabase";
import { useAuth, signInWithGoogle, signOut } from "./useAuth";
import {
  subscribeSyncStatus,
  getSyncStatus,
  retrySync,
  type SyncStatus,
} from "./syncController";

/**
 * The toolbar account cluster (design §"5. UI surface" → "Account control" +
 * "Sync-status chip"). It is the toolbar face of the auth + sync layer and is
 * driven entirely by `useAuth()` and the controller's status surface:
 *
 *  - Local_Only_Mode (`!isSyncConfigured`): a muted "Cloud sync not configured"
 *    indicator and NO sign-in control (Req 8.3, 2.1).
 *  - Configured + `signed_out`: a "Sign in with Google" button that starts the
 *    OAuth redirect (Req 2.1).
 *  - `signed_in`: the user's email (Req 2.5), a sign-out button (Req 2.6), and
 *    the sync-status chip (Req 9.5) — clickable to retry while `failed`.
 *  - `resolving`: nothing auth-specific, so the first paint is never blocked on
 *    session restore (Req 1.6, 3.6).
 *
 * This only reads auth state via `useAuth()` (the hook that drives this UI); it
 * does NOT start or stop the sync controller — task 5.3 mounts the controller at
 * the app root and ties its lifecycle to auth status.
 */

const SYNC_CHIP_LABEL: Record<SyncStatus, string> = {
  synced: "Synced",
  pending: "Syncing…",
  failed: "Sync failed",
};

const SYNC_CHIP_TITLE: Record<SyncStatus, string> = {
  synced: "Your library is up to date in the cloud.",
  pending: "Saving your library to the cloud…",
  failed: "The last sync failed. Click to retry.",
};

function SyncStatusChip() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);

  // Mirror the controller's status into local state (Req 9.5). The subscribe
  // call fires the listener once immediately, so the chip is correct on mount.
  useEffect(() => subscribeSyncStatus(setStatus), []);

  // `failed` is actionable: a click forces a retry of the current slice
  // (Req 9.5 → the chip is clickable to retry). The other states are inert
  // indicators, so render them as a plain span, not a button.
  if (status === "failed") {
    return (
      <button
        type="button"
        className="sync-chip sync-chip-failed"
        title={SYNC_CHIP_TITLE.failed}
        onClick={() => retrySync()}
      >
        {SYNC_CHIP_LABEL.failed}
      </button>
    );
  }

  return (
    <span
      className={`sync-chip sync-chip-${status}`}
      role="status"
      title={SYNC_CHIP_TITLE[status]}
    >
      {SYNC_CHIP_LABEL[status]}
    </span>
  );
}

export function AccountControl() {
  const { status, email } = useAuth();

  // Local_Only_Mode: say so, and offer no sign-in control (Req 8.3, 2.1).
  if (!isSyncConfigured) {
    return (
      <span className="account-control account-unconfigured">
        Cloud sync not configured
      </span>
    );
  }

  // Resolving a stored session: render nothing auth-specific so the first paint
  // isn't blocked on the session restore (Req 1.6, 3.6).
  if (status === "resolving") {
    return null;
  }

  // Configured but signed out: the single sign-in control (Req 2.1).
  if (status === "signed_out") {
    return (
      <div className="account-control">
        <button
          type="button"
          className="btn small"
          onClick={() => void signInWithGoogle()}
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  // Signed in: email (Req 2.5) + sign-out (Req 2.6) + the sync-status chip.
  return (
    <div className="account-control">
      <SyncStatusChip />
      {email && (
        <span className="account-email" title={email}>
          {email}
        </span>
      )}
      <button
        type="button"
        className="btn small ghost"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </div>
  );
}

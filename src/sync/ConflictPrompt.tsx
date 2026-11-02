import { useEffect, useRef, useState } from "react";
import {
  getPendingConflict,
  resolveConflictDownloadBackup,
  resolveConflictKeepLocal,
  resolveConflictUseCloud,
  subscribeConflict,
  type PendingConflict,
} from "./syncController";

/**
 * Conflict_Prompt (design §"5. UI surface" → "Conflict_Prompt", Req 5.3–5.7).
 *
 * A real modal — not a toast. The toast queue auto-dismisses after 6 s and a
 * toast carries only an optional `undo`, so it can't host three durable
 * choices. This dialog surfaces the Cloud_Newer_Condition and offers the user
 * Keep local / Use cloud / Download backup, each wired straight to the
 * controller's resolution handlers.
 *
 * Writes are blocked while the prompt is open purely by its existence: the
 * controller defers every write as long as `pendingConflict` is non-null
 * (`writesAllowed()` returns false), so this component renders the choice and
 * does nothing to the store or the row itself.
 *
 * Mounted at the app root by task 5.3.
 */
export function ConflictPrompt() {
  // Mirror the controller's conflict state into React state so the modal
  // mounts/unmounts as the controller opens/closes the prompt.
  const [conflict, setConflict] = useState<PendingConflict | null>(() =>
    getPendingConflict()
  );
  const keepLocalRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // subscribeConflict calls back once immediately with the current value, so
    // this also seeds the initial state on mount.
    return subscribeConflict(setConflict);
  }, []);

  // Move focus into the dialog when it opens so keyboard users land on a choice.
  useEffect(() => {
    if (conflict !== null) keepLocalRef.current?.focus();
  }, [conflict]);

  if (conflict === null) return null;

  const cloudVariants = conflict.cloudPayload.variants.length;
  const localVariants = conflict.localSlice.variants.length;

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-prompt-title"
        aria-describedby="conflict-prompt-body"
      >
        <h2 id="conflict-prompt-title" className="modal-title">
          Cloud library is newer
        </h2>
        <p id="conflict-prompt-body" className="modal-body">
          Your cloud library has changed since this device last synced, so it
          may differ from what you have here. Choose which copy to keep. Nothing
          is written until you pick — you can download a backup of this device's
          library first.
        </p>
        <p className="modal-meta">
          Cloud: {cloudVariants} variant{cloudVariants === 1 ? "" : "s"} · This
          device: {localVariants} variant{localVariants === 1 ? "" : "s"}
        </p>
        <div className="modal-actions">
          <button
            ref={keepLocalRef}
            type="button"
            className="btn primary"
            onClick={() => void resolveConflictKeepLocal()}
          >
            Keep local
          </button>
          <button
            type="button"
            className="btn"
            onClick={resolveConflictUseCloud}
          >
            Use cloud
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={resolveConflictDownloadBackup}
          >
            Download backup
          </button>
        </div>
      </div>
    </div>
  );
}

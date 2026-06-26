import { useUiStore } from "../store/uiStore";

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.undo && (
            <button
              className="undo"
              onClick={() => {
                t.undo?.();
                dismiss(t.id);
              }}
            >
              Undo
            </button>
          )}
          <button
            className="undo"
            style={{ color: "#a1a1aa" }}
            onClick={() => dismiss(t.id)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

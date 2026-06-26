type Props = {
  hidden?: boolean;
  onToggle: () => void;
  title?: string;
};

export function HideToggle({ hidden, onToggle, title }: Props) {
  return (
    <button
      className="btn ghost small"
      onClick={onToggle}
      title={title ?? (hidden ? "Show" : "Hide")}
      aria-pressed={!!hidden}
    >
      {hidden ? "👁‍🗨" : "👁"}
    </button>
  );
}

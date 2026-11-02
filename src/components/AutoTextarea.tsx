import { useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

/**
 * A textarea that grows and shrinks to fit its content, so a multi-line bullet
 * is fully visible without scrolling inside a one-line box or dragging a resize
 * handle. It is otherwise a drop-in for `<textarea>`: every prop (className,
 * value, onChange, onFocus, placeholder, aria-*, ...) is forwarded.
 *
 * How the auto-grow works: on every render where `value` changed we reset the
 * element's height to `auto` (so `scrollHeight` reflects the content, not the
 * previous box) and then set it to `scrollHeight`. A `useLayoutEffect` runs
 * this before paint, so the box never flashes at the wrong height.
 *
 * `ref` is accepted and merged, so callers that need the node (focus, drag)
 * still get it.
 */
type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** An optional external ref; merged with the internal measuring ref. */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
};

export function AutoTextarea({ textareaRef, value, ...rest }: Props) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    // Collapse first so scrollHeight measures the content, then grow to fit.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Re-measure whenever the value changes (typing, paste, programmatic edit).
  useLayoutEffect(() => {
    resize(innerRef.current);
  }, [value]);

  return (
    <textarea
      {...rest}
      value={value}
      rows={1}
      ref={(el) => {
        innerRef.current = el;
        // Measure as soon as the node mounts so the initial value fits too.
        resize(el);
        if (typeof textareaRef === "function") textareaRef(el);
        else if (textareaRef) {
          (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        }
      }}
      onInput={(e) => {
        // onChange also fires, but onInput lands first and keeps the box in
        // step with the keystroke even if the parent debounces its state.
        resize(e.currentTarget);
        rest.onInput?.(e);
      }}
    />
  );
}

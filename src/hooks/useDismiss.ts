import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Closes an open popover on an outside click or the Escape key.
 *
 * Attach the returned ref to the element that should count as "inside" — the
 * wrapper around both the trigger and the panel, so clicking the trigger to
 * close does not race with this handler reopening it.
 *
 * Listeners are only bound while `open`, and are torn down on close or unmount,
 * so a closed menu costs nothing.
 *
 * @typeParam T - Element type the ref is attached to.
 * @param open - Whether the popover is currently showing.
 * @param onDismiss - Called when the user clicks away or presses Escape.
 * @returns A ref for the popover's outermost element.
 */
export function useDismiss<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Keep the latest callback without rebinding listeners when it changes
  // identity, which it does on every render at most call sites.
  const handler = useRef(onDismiss);
  useEffect(() => {
    handler.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handler.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return ref;
}

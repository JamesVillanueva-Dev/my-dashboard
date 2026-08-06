import { useEffect, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';

/**
 * Media query for a pointing device that can be aimed — a mouse or a trackpad.
 *
 * A finger cannot steer anything it is not touching, so on a phone this effect
 * has nothing to follow and the setting is not offered at all.
 */
const FINE_POINTER = '(pointer: fine)';

/**
 * Custom properties the steerable background layer in `src/styles.css` reads.
 * Unset, that layer falls back to the fixed corner position it has always had.
 */
const X = '--aura-x';
const Y = '--aura-y';

/**
 * Marks the root while the aura is live, so the stylesheet can anchor that layer
 * to the viewport instead of the document.
 */
const ATTR = 'data-aura';

/** Whether this device has a pointer precise enough to steer the aura. */
function hasFinePointer(): boolean {
  return window.matchMedia?.(FINE_POINTER).matches ?? false;
}

/** What {@link useAura} hands back. */
export interface Aura {
  /** Whether this device has a mouse or trackpad, and so can run the effect. */
  supported: boolean;
  /** The stored choice. Off by default — a moving background is opt-in. */
  enabled: boolean;
  /** Records a new choice; persists and applies immediately. */
  setEnabled: (next: boolean) => void;
}

/**
 * Lets the page's accent aura — the large soft radial in the body background —
 * track the cursor instead of sitting in the top-right corner.
 *
 * The gradient's centre is a pair of custom properties on the document root, so
 * following the pointer is a property write rather than a re-render: nothing in
 * the React tree depends on the cursor, and the widgets never see a `pointermove`.
 * Writes are coalesced to one per animation frame, because `pointermove` fires
 * far more often than the page repaints and each write invalidates the whole
 * background.
 *
 * Ignores touch and pen input even on a hybrid laptop — the aura should not stay
 * parked wherever a finger last happened to land.
 *
 * Owned here rather than by the component that draws it, for the same reason
 * {@link useTheme} owns `data-theme`: the target is the document root, which no
 * component renders.
 *
 * @returns See {@link Aura}.
 */
export function useAura(): Aura {
  const [enabled, setEnabled] = useLocalStorage<boolean>('aura.follow', false);
  const [supported, setSupported] = useState(hasFinePointer);

  // Tracked live, so plugging a mouse into a tablet offers the setting without
  // a reload — and unplugging it stops the aura where it stands.
  useEffect(() => {
    const query = window.matchMedia?.(FINE_POINTER);
    if (!query?.addEventListener) return;
    const onChange = (e: MediaQueryListEvent) => setSupported(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const active = supported && enabled;

  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.setAttribute(ATTR, 'pointer');

    let frame = 0;
    let next: [number, number] | null = null;
    const paint = () => {
      frame = 0;
      if (next) {
        root.style.setProperty(X, `${next[0]}px`);
        root.style.setProperty(Y, `${next[1]}px`);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      // Viewport coordinates, matching the fixed attachment the stylesheet gives
      // this layer while the effect is on.
      next = [e.clientX, e.clientY];
      if (!frame) frame = requestAnimationFrame(paint);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
      root.removeAttribute(ATTR);
      root.style.removeProperty(X);
      root.style.removeProperty(Y);
    };
  }, [active]);

  return { supported, enabled, setEnabled };
}

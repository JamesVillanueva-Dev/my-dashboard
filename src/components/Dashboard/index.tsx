import {
  useState,
  useRef,
  useLayoutEffect,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import LegalModal, { type LegalDoc } from '../LegalModal';
import { WidgetChromeProvider } from '../Widget/chrome';
import Header from '../Header';
import Greeting from '../Greeting';
import TodayPanel from '../TodayPanel';
import WidgetMenu from '../WidgetMenu';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';
import { DEFAULT_LAYOUT, nextSize, widgetById, type WidgetSize } from '../../lib/registry';
import styles from './styles.module.css';

/**
 * Fallback grid row height and gap, in px, for when the computed style is not
 * readable (jsdom reports no value). The live values are read from the grid
 * itself; these only need to be in the right ballpark.
 */
const ROW = 8;
const GAP = 12;

/**
 * Root of the dashboard. Owns the persisted layout — the ordered list of enabled
 * widget ids — and renders a responsive masonry grid from it.
 *
 * Reordering is a custom pointer-based drag: grabbing a card's handle lifts the
 * card and makes it follow the cursor (or finger), the other cards glide out of
 * the way via a FLIP animation, and the card eases into its new slot on release.
 * Widgets can also be removed via the × on each card, and re-added or reset from
 * the widget menu. The user's name is persisted so the greeting survives reloads.
 */
export default function Dashboard() {
  const [name, setName] = useLocalStorage<string>('user.name', '');
  const [layout, setLayout] = useLocalStorage<string[]>('layout', DEFAULT_LAYOUT);
  /** Per-widget width overrides. Absent ids fall back to the registry default. */
  const [sizes, setSizes] = useLocalStorage<Record<string, WidgetSize>>('widget.sizes', {});
  const [showFocus, setShowFocus] = useLocalStorage<boolean>('today.showFocus', true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDoc>(null);
  /** Live-region text announcing a keyboard reorder or resize to screen readers. */
  const [announcement, setAnnouncement] = useState('');

  // Guard against ids from an older saved layout that no longer exist.
  const enabled = layout.filter((id) => widgetById(id));

  /** A widget's current width: the user's choice if they made one, else the default. */
  const sizeOf = (id: string): WidgetSize => sizes[id] ?? widgetById(id)?.size ?? 'standard';

  const resize = (id: string) => {
    const next = nextSize(sizeOf(id));
    setSizes((prev) => ({ ...prev, [id]: next }));
    const def = widgetById(id);
    if (def) setAnnouncement(`${def.title} resized to ${next}`);
  };

  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  const dragState = useRef<{ id: string; grabX: number; grabY: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /** Position the lifted card so the cursor stays at the point where it was grabbed. */
  const positionDragged = (x: number, y: number) => {
    const st = dragState.current;
    const el = st && itemRefs.current.get(st.id);
    if (!st || !el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const tx = x - st.grabX - r.left;
    const ty = y - st.grabY - r.top;
    el.style.transform = `translate(${tx}px, ${ty}px) scale(1.03) rotate(1.4deg)`;
  };

  // Give each panel a row span matching its content height. This is what lets a
  // column grid pack as tightly as the old masonry did while still allowing
  // multi-column spans — CSS multi-column could pack but never span, and a plain
  // grid can span but stretches every row to its tallest item.
  //
  // Runs before the FLIP effect below so spans are settled when it measures.
  useLayoutEffect(() => {
    const items = [...itemRefs.current.values()];

    // Read the real track size and gap rather than assuming the constants: the
    // gap narrows at the mobile breakpoint, and a stale value here would compute
    // spans too short, letting panels overlap.
    const grid = items[0]?.parentElement;
    const style = grid ? getComputedStyle(grid) : null;
    const row = Number.parseFloat(style?.gridAutoRows ?? '') || ROW;
    const gap = Number.parseFloat(style?.rowGap ?? '') || GAP;

    const apply = (item: HTMLElement) => {
      const content = item.firstElementChild as HTMLElement | null;
      if (!content) return;
      // offsetHeight, not getBoundingClientRect: a dragged panel carries a scale
      // transform, which would inflate its measured height and its span with it.
      const span = Math.max(1, Math.ceil((content.offsetHeight + gap) / (row + gap)));
      item.style.gridRowEnd = `span ${span}`;
    };

    items.forEach(apply);

    // Content changes height on its own — news loads, a form opens, a list grows.
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const item = (entry.target as HTMLElement).parentElement;
        if (item) apply(item);
      }
    });
    for (const item of items) {
      if (item.firstElementChild) observer.observe(item.firstElementChild);
    }
    return () => observer.disconnect();
  }, [enabled, sizes]);

  // FLIP: after a reorder re-renders, glide each card from its old box to its new
  // one. The card being dragged is excluded (it follows the pointer instead).
  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const draggingId = dragState.current?.id;
    const nextRects = new Map<string, DOMRect>();

    itemRefs.current.forEach((el, id) => {
      if (id === draggingId) return;
      const next = el.getBoundingClientRect();
      nextRects.set(id, next);
      const prev = prevRects.current.get(id);
      if (!prev || reduceMotion || typeof el.animate !== 'function') return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (dx || dy) {
        el.getAnimations().forEach((a) => a.cancel());
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
      }
    });

    prevRects.current = nextRects;
    // Keep the lifted card glued to the pointer after siblings shift.
    if (draggingId) positionDragged(lastPointer.current.x, lastPointer.current.y);
  }, [enabled]);

  const toggle = (id: string) =>
    setLayout((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const remove = (id: string) => setLayout((prev) => prev.filter((x) => x !== id));

  const reset = () => {
    setLayout(DEFAULT_LAYOUT);
    setSizes({});
  };

  /**
   * Moves a widget `delta` places in the layout — the keyboard path to the same
   * reordering the drag handle does with a pointer. Returns the new 1-based
   * position so the caller can announce it.
   */
  const move = (id: string, delta: number): void => {
    setLayout((prev) => {
      const from = prev.indexOf(id);
      if (from < 0) return prev;
      const to = Math.min(Math.max(from + delta, 0), prev.length - 1);
      if (to === from) return prev;
      const next = [...prev];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  };

  /** Arrow keys reorder; the grip is a real button so Enter/Space do nothing. */
  const onGripKeyDown = (e: ReactKeyboardEvent, id: string) => {
    const delta =
      e.key === 'ArrowUp' || e.key === 'ArrowLeft'
        ? -1
        : e.key === 'ArrowDown' || e.key === 'ArrowRight'
          ? 1
          : 0;
    if (!delta) return;
    e.preventDefault();
    move(id, delta);

    const def = widgetById(id);
    const at = enabled.indexOf(id) + delta;
    if (def) {
      setAnnouncement(
        `${def.title} moved to position ${Math.min(Math.max(at + 1, 1), enabled.length)} of ${enabled.length}`,
      );
    }
  };

  /**
   * Move `sourceId` before/after the widget the pointer is currently over.
   *
   * Which side counts as "after" depends on how the two panels sit. When the
   * pointer is inside the target's vertical band they are side by side, so the
   * horizontal midpoint decides; otherwise the panels are stacked and the
   * vertical midpoint does. A grid puts panels beside each other, which the
   * original vertical-only test could not express.
   */
  const reorderAround = (
    sourceId: string,
    overEl: HTMLElement,
    pointerX: number,
    pointerY: number,
  ) => {
    const overId = overEl.dataset.id;
    if (!overId || overId === sourceId) return;
    const rect = overEl.getBoundingClientRect();
    const sideBySide = pointerY >= rect.top && pointerY <= rect.bottom;
    const after = sideBySide
      ? pointerX > rect.left + rect.width / 2
      : pointerY > rect.top + rect.height / 2;
    setLayout((prev) => {
      const next = prev.filter((x) => x !== sourceId);
      let at = next.indexOf(overId);
      if (at < 0) return prev;
      if (after) at += 1;
      next.splice(at, 0, sourceId);
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev;
      return next;
    });
  };

  /** Start a pointer-based drag from a widget's grip. */
  const onGrab = (e: ReactPointerEvent, id: string) => {
    const el = itemRefs.current.get(id);
    if (!el || e.button !== 0) return;
    const r = el.getBoundingClientRect();
    dragState.current = { id, grabX: e.clientX - r.left, grabY: e.clientY - r.top };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    el.style.pointerEvents = 'none';
    setDragId(id);
    positionDragged(e.clientX, e.clientY);

    const onMove = (ev: PointerEvent) => {
      lastPointer.current = { x: ev.clientX, y: ev.clientY };
      positionDragged(ev.clientX, ev.clientY);
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const item = under?.closest<HTMLElement>(`.${styles.item}`);
      if (item) reorderAround(id, item, ev.clientX, ev.clientY);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const dropped = itemRefs.current.get(id);
      if (dropped) {
        const first = dropped.getBoundingClientRect();
        dropped.style.transform = '';
        dropped.style.pointerEvents = '';
        const last = dropped.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if ((dx || dy) && typeof dropped.animate === 'function') {
          dropped.getAnimations().forEach((a) => a.cancel());
          dropped.animate(
            [
              { transform: `translate(${dx}px, ${dy}px) scale(1.03) rotate(1.4deg)` },
              { transform: 'translate(0, 0) scale(1) rotate(0)' },
            ],
            { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
          );
        }
      }
      dragState.current = null;
      setDragId(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  };

  return (
    <DashboardDataProvider>
      <div className={`${styles.container}${dragId ? ` ${styles.isGrabbing}` : ''}`}>
        <Header
          actions={
            <WidgetMenu
              layout={enabled}
              onToggle={toggle}
              onReset={reset}
              showFocus={showFocus}
              onToggleFocus={() => setShowFocus((prev) => !prev)}
            />
          }
        />

        <div className={styles.body}>
          <Greeting name={name} onNameChange={setName} />
          <TodayPanel showFocus={showFocus} />

          <p aria-live="polite" className={styles.srOnly}>
            {announcement}
          </p>

          {enabled.length === 0 ? (
            <p className={styles.empty}>
              No widgets enabled. Open <strong>Widgets</strong> to add some.
            </p>
          ) : (
            <main>
              {enabled.map((id) => {
                const def = widgetById(id)!;
                return (
                  <div
                    key={id}
                    data-id={id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(id, el);
                      else itemRefs.current.delete(id);
                    }}
                    className={[
                      styles.item,
                      styles[sizeOf(id)],
                      dragId === id ? styles.isDragging : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <WidgetChromeProvider
                      value={{
                        id,
                        size: sizeOf(id),
                        onResize: () => resize(id),
                        onRemove: () => remove(id),
                        onGrab,
                        onGripKeyDown,
                        isDragging: dragId === id,
                      }}
                    >
                      {def.render()}
                    </WidgetChromeProvider>
                  </div>
                );
              })}
            </main>
          )}

          <footer>
            <nav aria-label="Legal">
              <button onClick={() => setLegal('privacy')}>Privacy Policy</button>
              <span aria-hidden="true">·</span>
              <button onClick={() => setLegal('terms')}>Terms of Service</button>
            </nav>
            <span>
              Weather by Open-Meteo · Headlines via public RSS · Your data stays in this browser
            </span>
          </footer>
        </div>

        <LegalModal doc={legal} onClose={() => setLegal(null)} />
      </div>
    </DashboardDataProvider>
  );
}

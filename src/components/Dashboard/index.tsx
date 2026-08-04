import {
  useState,
  useRef,
  useCallback,
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
import Footer from '../Footer';
import WidgetMenu from '../WidgetMenu';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';
import {
  DEFAULT_LAYOUT,
  MAX_COLS,
  clampCols,
  clampHeight,
  normalizeSize,
  widgetById,
  type WidgetSize,
} from '../../lib/registry';
import styles from './styles.module.css';

/**
 * Fallback grid row height and gap, in px, for when the computed style is not
 * readable (jsdom reports no value). The live values are read from the grid
 * itself; these only need to be in the right ballpark.
 */
const ROW = 8;
const GAP = 12;

/** How much one arrow-key press changes a panel's height, in px. */
const HEIGHT_STEP = 24;

/**
 * How far a resize drag must travel vertically before it pins the height.
 * Without it, dragging purely sideways would freeze the panel at whatever height
 * its content happened to be, which is not what that gesture asked for.
 */
const PIN_THRESHOLD = 5;

/** Reads the grid's live track size and gap, falling back to the constants above. */
function gridMetrics(grid: HTMLElement | null) {
  const style = grid ? getComputedStyle(grid) : null;
  const tracks = (style?.gridTemplateColumns ?? '').split(' ').filter(Boolean);
  return {
    row: Number.parseFloat(style?.gridAutoRows ?? '') || ROW,
    gap: Number.parseFloat(style?.rowGap ?? '') || GAP,
    colGap: Number.parseFloat(style?.columnGap ?? '') || GAP,
    /** Width of a single column track, or 0 when the grid cannot be measured. */
    colWidth: Number.parseFloat(tracks[0] ?? '') || 0,
    /** Columns the grid currently has; 0 when it cannot be measured. */
    columns: tracks.length,
  };
}

/**
 * Writes a panel's chosen size onto its grid item as custom properties, which
 * the stylesheet turns into a column span and a card height.
 *
 * The width is capped at the columns actually on screen: an item spanning more
 * than the grid has would create implicit columns and overflow the page.
 */
function applySize(item: HTMLElement, size: WidgetSize, columns: number) {
  item.style.setProperty('--cols', String(Math.min(size.cols, Math.max(1, columns))));
  if (size.height == null) item.style.removeProperty('--h');
  else item.style.setProperty('--h', `${size.height}px`);
}

/**
 * Gives a panel a row span matching its rendered height. This is what lets a
 * column grid pack as tightly as the old masonry did while still allowing
 * multi-column spans — CSS multi-column could pack but never span, and a plain
 * grid can span but stretches every row to its tallest item.
 */
function applySpan(item: HTMLElement) {
  const content = item.firstElementChild as HTMLElement | null;
  if (!content) return;
  const { row, gap } = gridMetrics(item.parentElement);
  // offsetHeight, not getBoundingClientRect: a dragged panel carries a scale
  // transform, which would inflate its measured height and its span with it.
  const span = Math.max(1, Math.ceil((content.offsetHeight + gap) / (row + gap)));
  item.style.gridRowEnd = `span ${span}`;
}

/**
 * Root of the dashboard. Owns the persisted layout — the ordered list of enabled
 * widget ids — and renders a responsive masonry grid from it.
 *
 * Reordering is a custom pointer-based drag: grabbing a card's handle lifts the
 * card and makes it follow the cursor (or finger), the other cards glide out of
 * the way via a FLIP animation, and the card eases into its new slot on release.
 * Resizing is a second drag, from each card's bottom-right corner, setting width
 * and height at once. Widgets can also be removed via the × on each card, and
 * re-added or reset from the widget menu. The user's name is persisted so the
 * greeting survives reloads.
 */
export default function Dashboard() {
  const [name, setName] = useLocalStorage<string>('user.name', '');
  const [layout, setLayout] = useLocalStorage<string[]>('layout', DEFAULT_LAYOUT);
  /** Per-widget size overrides. Absent ids fall back to the registry default. */
  const [sizes, setSizes] = useLocalStorage<Record<string, unknown>>('widget.sizes', {});
  const [showFocus, setShowFocus] = useLocalStorage<boolean>('today.showFocus', true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [resizeId, setResizeId] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDoc>(null);
  /** Live-region text announcing a keyboard reorder or resize to screen readers. */
  const [announcement, setAnnouncement] = useState('');
  /**
   * Columns the grid currently shows, measured rather than assumed: it is what a
   * horizontal resize drag is clamped to, and it changes with the window.
   * Starts at the stored ceiling so nothing is clamped before the first measure.
   */
  const [columns, setColumns] = useState(MAX_COLS);

  // Guard against ids from an older saved layout that no longer exist.
  const enabled = layout.filter((id) => widgetById(id));

  /** A widget's current size: the user's choice if they made one, else the default. */
  const sizeOf = useCallback(
    (id: string): WidgetSize => normalizeSize(sizes[id], widgetById(id)?.cols ?? 2),
    [sizes],
  );

  /** Records a new size for one panel and tells screen readers what it became. */
  const commitSize = (id: string, size: WidgetSize) => {
    setSizes((prev) => ({ ...prev, [id]: size }));
    const def = widgetById(id);
    if (!def) return;
    const width = `${size.cols} ${size.cols === 1 ? 'column' : 'columns'} wide`;
    const height = size.height == null ? 'height fits the content' : `${size.height} pixels tall`;
    setAnnouncement(`${def.title} resized to ${width}, ${height}`);
  };

  const gridRef = useRef<HTMLElement | null>(null);
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

  // Track how many columns the grid actually has, so a resize drag can never
  // widen a panel past the edge of the page. `auto-fill` decides this from the
  // available width, so only the grid itself knows the answer.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const { columns: n } = gridMetrics(grid);
      // jsdom reports no tracks at all; leave the ceiling in place there.
      if (n > 0) setColumns(n);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [enabled.length]);

  // Write each panel's chosen size onto its grid item, then give it a row span
  // matching the height that results.
  //
  // Runs before the FLIP effect below so spans are settled when it measures.
  useLayoutEffect(() => {
    const items = [...itemRefs.current.entries()];

    const apply = ([id, item]: [string, HTMLElement]) => {
      applySize(item, sizeOf(id), columns);
      applySpan(item);
    };

    items.forEach(apply);

    // Content changes height on its own — news loads, a form opens, a list grows.
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const item = (entry.target as HTMLElement).parentElement;
        if (item) applySpan(item);
      }
    });
    for (const [, item] of items) {
      if (item.firstElementChild) observer.observe(item.firstElementChild);
    }
    return () => observer.disconnect();
  }, [enabled, sizeOf, columns]);

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
   * Resize a panel by dragging the handle in its bottom-right corner. One gesture
   * drives both axes, but they behave differently, because the dashboard is a
   * column grid: horizontal movement snaps to whole columns, vertical movement is
   * free pixels.
   *
   * The live size is written straight to the DOM rather than to state, so the
   * panel tracks the pointer at frame rate and the layout is only re-rendered —
   * and only persisted — once, on release.
   */
  const onResizeStart = (e: ReactPointerEvent, id: string) => {
    const item = itemRefs.current.get(id);
    const card = item?.firstElementChild as HTMLElement | undefined;
    if (!item || !card || e.button !== 0) return;
    e.preventDefault();

    const start = sizeOf(id);
    const { colWidth, colGap } = gridMetrics(item.parentElement);
    // Snapping needs to know how far the pointer must travel to earn a column.
    // Fall back to the panel's own width per column if the grid can't be read.
    const step = (colWidth || item.getBoundingClientRect().width / start.cols) + colGap;
    const startHeight = card.offsetHeight;
    const startX = e.clientX;
    const startY = e.clientY;
    let size = start;

    setResizeId(id);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      size = {
        cols: step > 0 ? clampCols(start.cols + dx / step, columns) : start.cols,
        // A purely sideways drag leaves the height alone rather than freezing it
        // at whatever the content happened to need.
        height:
          start.height == null && Math.abs(dy) < PIN_THRESHOLD
            ? null
            : clampHeight(startHeight + dy),
      };
      applySize(item, size, columns);
      applySpan(item);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setResizeId(null);
      commitSize(id, size);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Arrow keys resize: left/right by a column, up/down by {@link HEIGHT_STEP}px. */
  const onResizeKeyDown = (e: ReactKeyboardEvent, id: string) => {
    const current = sizeOf(id);
    // Growing from "fits the content" has to start somewhere: the height the
    // panel is showing right now, so the first press nudges rather than jumps.
    const card = itemRefs.current.get(id)?.firstElementChild as HTMLElement | undefined;
    const height = current.height ?? card?.offsetHeight ?? 0;

    const next: WidgetSize | null =
      e.key === 'ArrowLeft'
        ? { ...current, cols: clampCols(current.cols - 1, columns) }
        : e.key === 'ArrowRight'
          ? { ...current, cols: clampCols(current.cols + 1, columns) }
          : e.key === 'ArrowUp'
            ? { ...current, height: clampHeight(height - HEIGHT_STEP) }
            : e.key === 'ArrowDown'
              ? { ...current, height: clampHeight(height + HEIGHT_STEP) }
              : // The handle is a button, so Enter/Space have to do something; the
                // keyboard equivalent of double-clicking it is the useful thing.
                e.key === 'Enter' || e.key === ' '
                ? { ...current, height: null }
                : null;

    if (!next) return;
    e.preventDefault();
    commitSize(id, next);
  };

  /** Unpin a panel's height, letting it grow with its content again. */
  const fitHeight = (id: string) => commitSize(id, { ...sizeOf(id), height: null });

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
      <div
        className={[styles.container, dragId && styles.isGrabbing, resizeId && styles.isResizing]
          .filter(Boolean)
          .join(' ')}
      >
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
            <main ref={gridRef}>
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
                    className={`${styles.item}${dragId === id ? ` ${styles.isDragging}` : ''}`}
                  >
                    <WidgetChromeProvider
                      value={{
                        id,
                        size: sizeOf(id),
                        onResizeStart,
                        onResizeKeyDown,
                        onFitHeight: fitHeight,
                        onRemove: () => remove(id),
                        onGrab,
                        onGripKeyDown,
                        isDragging: dragId === id,
                        isResizing: resizeId === id,
                      }}
                    >
                      {def.render()}
                    </WidgetChromeProvider>
                  </div>
                );
              })}
            </main>
          )}

          <Footer onOpenLegal={setLegal} />
        </div>

        <LegalModal doc={legal} onClose={() => setLegal(null)} />
      </div>
    </DashboardDataProvider>
  );
}

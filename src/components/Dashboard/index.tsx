import {
  useState,
  useRef,
  useMemo,
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
import { useSyncStatus } from '../../hooks/useProfileSync';
import { stepDrag, type DragTarget, type PanelRect } from '../../lib/dragOrder';
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

/**
 * How far the pointer must travel before a grab becomes a drag, in px.
 *
 * Without it, a plain click on the grip lifts the card — scaling and rotating it
 * for the length of the click, which reads as a glitch rather than as a gesture.
 */
const DRAG_THRESHOLD = 4;

/**
 * How long a finger must rest on the grip before it starts a drag, in ms.
 *
 * A mouse press is unambiguous, so it lifts immediately; a touch is not — the
 * same contact begins a scroll, a tap, or a drag. Waiting a moment is how the
 * gesture is told apart, and it is the convention every touch reorder UI uses.
 */
const TOUCH_HOLD_MS = 180;

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
 * The translation an element's transform is currently applying.
 *
 * Needed because `getBoundingClientRect()` **includes** transforms — including
 * the ones a running Web Animation is driving. Subtracting this is the only way
 * to ask where the *layout* has put an element while it is still gliding, and
 * getting that wrong is what made the old FLIP compound its error across
 * reorders.
 */
function translation(el: HTMLElement): { x: number; y: number } {
  if (typeof DOMMatrixReadOnly !== 'function') return { x: 0, y: 0 };
  const value = getComputedStyle(el).transform;
  if (!value || value === 'none') return { x: 0, y: 0 };
  try {
    const matrix = new DOMMatrixReadOnly(value);
    return { x: matrix.m41, y: matrix.m42 };
  } catch {
    // Unparseable transform (jsdom returns odd values); treat it as none.
    return { x: 0, y: 0 };
  }
}

/** Where the grid has put a panel, with any animation transform taken back off. */
function layoutRect(el: HTMLElement, id: string): PanelRect {
  const rect = el.getBoundingClientRect();
  const offset = translation(el);
  return {
    id,
    x: rect.left - offset.x,
    y: rect.top - offset.y,
    width: rect.width,
    height: rect.height,
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

/** Everything one in-flight pointer drag needs to remember. */
interface DragSession {
  /** The panel being dragged. */
  id: string;
  /** Pointer offset inside the card at the moment it was grabbed. */
  grabX: number;
  grabY: number;
  /** Where the pointer went down, for the movement threshold. */
  startX: number;
  startY: number;
  /** Latest pointer position, so the card can be re-placed after a reorder. */
  x: number;
  y: number;
  /** Which pointer this is, for releasing capture on the way out. */
  pointerId: number;
  /** The grip that captured the pointer; listeners live on it. */
  node: HTMLElement;
  /**
   * `false` until the gesture has earned the lift — past {@link DRAG_THRESHOLD}
   * for a mouse, or past {@link TOUCH_HOLD_MS} for a finger. Nothing moves and
   * nothing is styled until this turns true.
   */
  active: boolean;
  /** What the reorder model last settled on. See `lib/dragOrder.ts`. */
  target: DragTarget | null;
  /** Pending hold timer for a touch drag, if any. */
  hold: number | null;
  /** Pending rAF for the move handler, if any. */
  frame: number | null;
}

/**
 * Root of the dashboard. Owns the persisted layout — the ordered list of enabled
 * widget ids — and renders a responsive masonry grid from it.
 *
 * Reordering is a custom pointer-based drag: grabbing a card's handle lifts the
 * card and makes it follow the cursor (or finger), the other cards glide out of
 * the way via a FLIP animation, and the card eases into its new slot on release.
 * Where it lands is decided by `lib/dragOrder.ts` rather than by hit-testing the
 * point under the cursor — most of this grid is empty space, so that question
 * has no useful answer most of the time.
 *
 * Resizing is a second drag, from each card's bottom-right corner, setting width
 * and height at once. Widgets can also be removed via the × on each card, and
 * re-added or reset from the widget menu. The user's name is persisted so the
 * greeting survives reloads.
 */
export default function Dashboard() {
  const sync = useSyncStatus();
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

  // Guard against ids from an older saved layout that no longer exist. Memoised
  // so the effects below key off an actual change rather than off a new array
  // every render — the FLIP effect used to re-measure on every render because
  // this was a fresh `filter` each time.
  const enabled = useMemo(() => layout.filter((id) => widgetById(id)), [layout]);

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
  /** Layout positions from the last measure, keyed by id. Drives FLIP and the drag. */
  const layoutRects = useRef<Map<string, PanelRect>>(new Map());
  const dragState = useRef<DragSession | null>(null);
  /**
   * The live saved order, for the drag's frame callback to read without
   * re-binding its listeners. Deliberately the *full* layout rather than
   * `enabled`: reordering through the filtered list would quietly drop ids from
   * a saved layout whose widget no longer exists.
   */
  const layoutRef = useRef(layout);
  // Synced in an effect rather than during render: refs are not render state,
  // and the drag only reads this from a rAF callback, which runs later anyway.
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });

  /** Re-reads every panel's layout box. Cheap enough per reorder, not per frame. */
  const measureLayout = () => {
    layoutRects.current = new Map();
    itemRefs.current.forEach((el, id) => layoutRects.current.set(id, layoutRect(el, id)));
  };

  /** Position the lifted card so the cursor stays at the point where it was grabbed. */
  const positionDragged = (x: number, y: number) => {
    const st = dragState.current;
    const el = st && itemRefs.current.get(st.id);
    if (!st || !el || !st.active) return;
    // Against the cached layout box, so the pointer path neither writes nor
    // reads geometry — the old version cleared the transform and re-measured on
    // every single move, forcing a synchronous reflow each time.
    const box = layoutRects.current.get(st.id);
    if (!box) return;
    el.style.transform = `translate(${x - st.grabX - box.x}px, ${y - st.grabY - box.y}px) scale(1.03) rotate(1.4deg)`;
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
      // Not while a drag is in flight: re-spanning moves panels out from under
      // the cursor with no animation, which reads as the layout glitching on its
      // own. Whatever grew will be re-spanned when the drag ends.
      if (dragState.current?.active) return;
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

  // FLIP: after a reorder re-renders, glide each card from where it *looked* to
  // where it now belongs.
  //
  // "Where it looked" matters. A card interrupted mid-glide is still carrying a
  // partial transform, so the delta has to be measured against its current
  // visual position, not against the layout position it was heading for.
  // Cancelling and restarting from a stale delta — what this used to do — makes
  // the card teleport on every reorder.
  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const draggingId = dragState.current?.active ? dragState.current.id : undefined;
    const previous = layoutRects.current;
    const nextRects = new Map<string, PanelRect>();

    itemRefs.current.forEach((el, id) => {
      if (id === draggingId) {
        // The lifted card carries our own scale/rotate, which would corrupt a
        // measurement. Take it off, measure, put it back — once per reorder,
        // not once per pointer event.
        const held = el.style.transform;
        el.style.transform = '';
        nextRects.set(id, layoutRect(el, id));
        el.style.transform = held;
        return;
      }

      // Read the in-flight offset *before* cancelling anything, then derive the
      // layout box from it.
      const offset = translation(el);
      const rect = el.getBoundingClientRect();
      const next: PanelRect = {
        id,
        x: rect.left - offset.x,
        y: rect.top - offset.y,
        width: rect.width,
        height: rect.height,
      };
      nextRects.set(id, next);

      const prev = previous.get(id);
      if (!prev || reduceMotion || typeof el.animate !== 'function') return;

      // Composite FLIP: (where it was) - (where it will be) + (how far it has
      // already travelled). With no animation running `offset` is zero and this
      // is the ordinary FLIP delta.
      const dx = prev.x - next.x + offset.x;
      const dy = prev.y - next.y + offset.y;
      if (!dx && !dy) return;

      el.getAnimations().forEach((a) => a.cancel());
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    });

    layoutRects.current = nextRects;
    // Keep the lifted card glued to the pointer after siblings shift.
    const st = dragState.current;
    if (st?.active) positionDragged(st.x, st.y);
  }, [enabled, sizes, columns]);

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

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setResizeId(null);
      commitSize(id, size);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    // Without this a cancelled gesture (a system swipe, a lost pointer) leaves
    // the panel mid-resize and the listeners attached forever.
    window.addEventListener('pointercancel', finish);
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

  /** Turns the pending grab into a real drag: lifts the card and takes a baseline. */
  const beginDrag = () => {
    const st = dragState.current;
    if (!st || st.active) return;
    st.active = true;
    st.hold = null;
    measureLayout();
    setDragId(st.id);
    positionDragged(st.x, st.y);
  };

  /**
   * Start a pointer-based drag from a widget's grip.
   *
   * The pointer is captured by the grip, so the gesture survives the pointer
   * leaving the card, crossing another element, or running off the window.
   */
  const onGrab = (e: ReactPointerEvent, id: string) => {
    const el = itemRefs.current.get(id);
    const node = e.currentTarget as HTMLElement;
    if (!el || e.button !== 0 || dragState.current) return;

    const box = layoutRect(el, id);
    const session: DragSession = {
      id,
      grabX: e.clientX - box.x,
      grabY: e.clientY - box.y,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      node,
      active: false,
      target: null,
      hold: null,
      frame: null,
    };
    dragState.current = session;

    try {
      // Capture keeps the gesture attached to this grip when the pointer leaves
      // the card or runs off the window, and is what makes a touch drag hold on
      // to its finger. Note the listeners below are on `window`, not on the
      // grip: capture retargets events but they still bubble, and binding to the
      // grip alone loses the drag the moment a re-render disturbs that element.
      node.setPointerCapture(e.pointerId);
    } catch {
      // Capture is unavailable (jsdom, or a pointer that has already gone).
      // The window listeners below still work; only the guarantee is lost.
    }

    // A finger has to commit before it gets a drag, or every attempt to scroll
    // the page from a grip becomes a reorder. A mouse press is unambiguous.
    if (e.pointerType === 'touch') {
      session.hold = window.setTimeout(beginDrag, TOUCH_HOLD_MS);
    }

    /** Reads the latest pointer position once per frame, not once per event. */
    const step = () => {
      const st = dragState.current;
      if (!st) return;
      st.frame = null;
      if (!st.active) return;

      positionDragged(st.x, st.y);

      const order = layoutRef.current;
      const result = stepDrag({
        rects: [...layoutRects.current.values()],
        x: st.x,
        y: st.y,
        draggedId: st.id,
        order,
        target: st.target,
      });
      st.target = result.target;
      // Reference equality means nothing moved — skip the render entirely.
      if (result.order !== order) setLayout(result.order);
    };

    const onMove = (ev: PointerEvent) => {
      const st = dragState.current;
      if (!st || ev.pointerId !== st.pointerId) return;
      st.x = ev.clientX;
      st.y = ev.clientY;

      if (!st.active) {
        const travelled = Math.hypot(ev.clientX - st.startX, ev.clientY - st.startY);
        if (travelled < DRAG_THRESHOLD) return;
        // A finger that moves before the hold elapses is scrolling, not
        // dragging: drop the gesture rather than stealing it.
        if (ev.pointerType === 'touch' && st.hold !== null) {
          clearTimeout(st.hold);
          finish();
          return;
        }
        beginDrag();
      }

      if (st.frame === null) st.frame = requestAnimationFrame(step);
    };

    /**
     * The single exit. `pointerup` and `pointercancel` both land here, because
     * having two teardown paths is exactly how a cancelled drag used to leave a
     * panel stuck mid-air with its listeners still attached.
     */
    const finish = () => {
      const st = dragState.current;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (!st) return;

      if (st.hold !== null) clearTimeout(st.hold);
      if (st.frame !== null) cancelAnimationFrame(st.frame);
      try {
        node.releasePointerCapture(st.pointerId);
      } catch {
        // Already released, or never captured.
      }

      const dropped = itemRefs.current.get(st.id);
      if (st.active && dropped) {
        const first = dropped.getBoundingClientRect();
        dropped.style.transform = '';
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
      } else if (dropped) {
        dropped.style.transform = '';
      }

      dragState.current = null;
      setDragId(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
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

          {sync.error && (
            <p className={styles.syncError} role="alert">
              {sync.error}
            </p>
          )}

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

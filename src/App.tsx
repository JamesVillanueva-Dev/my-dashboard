import { useState, useRef, useLayoutEffect, type PointerEvent as ReactPointerEvent } from 'react';
import './App.css';
import { useLocalStorage } from './hooks/useLocalStorage';
import Header from './components/Header';
import WidgetMenu from './components/WidgetMenu';
import LegalModal, { type LegalDoc } from './components/Legal';
import { WidgetChromeProvider } from './chrome/WidgetChrome';
import { DEFAULT_LAYOUT, widgetById } from './widgets/registry';

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
function App() {
  const [name, setName] = useLocalStorage<string>('user.name', '');
  const [layout, setLayout] = useLocalStorage<string[]>('layout', DEFAULT_LAYOUT);
  const [dragId, setDragId] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDoc>(null);

  // Guard against ids from an older saved layout that no longer exist.
  const enabled = layout.filter((id) => widgetById(id));

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

  const reset = () => setLayout(DEFAULT_LAYOUT);

  /** Move `sourceId` before/after the widget the pointer is currently over. */
  const reorderAround = (sourceId: string, overEl: HTMLElement, pointerY: number) => {
    const overId = overEl.dataset.id;
    if (!overId || overId === sourceId) return;
    const rect = overEl.getBoundingClientRect();
    const after = pointerY > rect.top + rect.height / 2;
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
      const item = under?.closest<HTMLElement>('.grid__item');
      if (item) reorderAround(id, item, ev.clientY);
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
    <div className={`dashboard${dragId ? ' is-grabbing' : ''}`}>
      <Header
        name={name}
        onNameChange={setName}
        actions={<WidgetMenu layout={enabled} onToggle={toggle} onReset={reset} />}
      />

      {enabled.length === 0 ? (
        <p className="empty">
          No widgets enabled. Open <strong>⚙️ Widgets</strong> to add some.
        </p>
      ) : (
        <main className="grid">
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
                className={`grid__item${dragId === id ? ' is-dragging' : ''}`}
              >
                <WidgetChromeProvider
                  value={{ id, onRemove: () => remove(id), onGrab, isDragging: dragId === id }}
                >
                  {def.render()}
                </WidgetChromeProvider>
              </div>
            );
          })}
        </main>
      )}

      <footer className="foot">
        <nav className="foot__links" aria-label="Legal">
          <button className="link" onClick={() => setLegal('privacy')}>
            Privacy Policy
          </button>
          <span aria-hidden="true">·</span>
          <button className="link" onClick={() => setLegal('terms')}>
            Terms of Service
          </button>
        </nav>
        <span>Weather by Open-Meteo · Headlines via public RSS · Your data stays in this browser</span>
      </footer>

      <LegalModal doc={legal} onClose={() => setLegal(null)} />
    </div>
  );
}

export default App;

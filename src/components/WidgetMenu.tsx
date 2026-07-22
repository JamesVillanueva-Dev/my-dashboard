import { useEffect, useRef, useState } from 'react';
import { WIDGETS } from '../widgets/registry';

/** Props for {@link WidgetMenu}. */
interface WidgetMenuProps {
  /** Ordered ids of currently enabled widgets. */
  layout: string[];
  /** Toggle a widget on/off by id. */
  onToggle: (id: string) => void;
  /** Restore the default set and order of widgets. */
  onReset: () => void;
}

/**
 * Dropdown that lists every available widget with a checkbox to enable/disable it,
 * plus a "Reset layout" action. Closes on outside click or the Escape key.
 *
 * @param props - See {@link WidgetMenuProps}.
 */
export default function WidgetMenu({ layout, onToggle, onReset }: WidgetMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className="pill menu__button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Manage widgets"
        title="Manage widgets"
      >
        ⚙️ Widgets
      </button>
      {open && (
        <div className="menu__panel" role="menu">
          <p className="menu__title">Show widgets</p>
          <ul className="menu__list">
            {WIDGETS.map((w) => {
              const enabled = layout.includes(w.id);
              return (
                <li key={w.id}>
                  <label>
                    <input type="checkbox" checked={enabled} onChange={() => onToggle(w.id)} />
                    <span className="menu__icon" aria-hidden="true">{w.icon}</span>
                    {w.title}
                  </label>
                </li>
              );
            })}
          </ul>
          <button className="link menu__reset" onClick={onReset}>
            Reset to default layout
          </button>
        </div>
      )}
    </div>
  );
}

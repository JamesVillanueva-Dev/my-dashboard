import { useEffect, useRef, useState } from 'react';
import { WIDGETS } from '../../lib/registry';
import styles from './styles.module.css';

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
    <div className={styles.container} ref={ref}>
      <button
        className={styles.button}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Manage widgets"
        title="Manage widgets"
      >
        ⚙️ Widgets
      </button>
      {open && (
        <div role="menu">
          <p>Show widgets</p>
          <ul>
            {WIDGETS.map((w) => (
              <li key={w.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={layout.includes(w.id)}
                    onChange={() => onToggle(w.id)}
                  />
                  <span aria-hidden="true">{w.icon}</span>
                  {w.title}
                </label>
              </li>
            ))}
          </ul>
          <button className={styles.reset} onClick={onReset}>
            Reset to default layout
          </button>
        </div>
      )}
    </div>
  );
}

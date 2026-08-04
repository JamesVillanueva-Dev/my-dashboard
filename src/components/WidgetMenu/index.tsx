import { useState } from 'react';
import Icon from '../Icon';
import { useDismiss } from '../../hooks/useDismiss';
import { WIDGETS } from '../../lib/registry';
import styles from './styles.module.css';

/** Props for {@link WidgetMenu}. */
interface WidgetMenuProps {
  /** Ordered ids of currently enabled widgets. */
  layout: string[];
  /** Toggle a widget on/off by id. */
  onToggle: (id: string) => void;
  /** Restore the default set, order, and sizes of widgets. */
  onReset: () => void;
  /** Whether the Today zone shows the daily focus field. */
  showFocus: boolean;
  /** Show or hide the daily focus field. */
  onToggleFocus: () => void;
}

/**
 * Dropdown that lists every available widget with a checkbox to enable/disable it,
 * plus a "Reset layout" action. Closes on outside click or the Escape key.
 *
 * @param props - See {@link WidgetMenuProps}.
 */
export default function WidgetMenu({
  layout,
  onToggle,
  onReset,
  showFocus,
  onToggleFocus,
}: WidgetMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

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
        <Icon name="grid" /> Widgets
      </button>
      {open && (
        <div role="menu">
          <p>Today</p>
          <ul>
            <li>
              <label>
                <input type="checkbox" checked={showFocus} onChange={onToggleFocus} />
                <Icon name="target" />
                Daily focus
              </label>
            </li>
          </ul>

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
                  <Icon name={w.icon} />
                  {w.title}
                </label>
              </li>
            ))}
          </ul>
          <p className={styles.note}>Resize a panel from the ⟷ button in its header.</p>

          <button className={styles.reset} onClick={onReset}>
            Reset layout and sizes
          </button>
        </div>
      )}
    </div>
  );
}

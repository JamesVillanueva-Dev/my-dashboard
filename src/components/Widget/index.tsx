import type { ReactNode } from 'react';
import { useWidgetChrome } from './chrome';
import styles from './styles.module.css';

/** Props for the shared {@link Widget} card wrapper. */
interface WidgetProps {
  /** Heading text shown in the card header. */
  title: string;
  /** Optional emoji/glyph rendered before the title. */
  icon?: string;
  /** Optional element rendered on the right of the header (buttons, status, etc.) */
  action?: ReactNode;
  /**
   * The calling widget's own root class — pass `styles.container` from that
   * widget's `styles.module.css`, so its module scopes the whole card without
   * needing an extra wrapper element.
   */
  className?: string;
  /** Widget body content. */
  children: ReactNode;
}

/**
 * Card shell shared by every dashboard widget. Provides the consistent header
 * (drag handle + icon + title + optional action slot + remove button) and body
 * container so individual widgets only render their own content.
 *
 * When rendered inside the dashboard grid it reads {@link useWidgetChrome} to show
 * a drag handle (for reordering) and a remove button (to disable the widget), and
 * to style itself as lifted while being dragged. Rendered outside the grid, those
 * controls are simply absent.
 *
 * @param props - See {@link WidgetProps}.
 */
export default function Widget({ title, icon, action, className, children }: WidgetProps) {
  const chrome = useWidgetChrome();
  const classes = [styles.container, className, chrome?.isDragging && styles.isDragging]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes}>
      <header>
        <div>
          {chrome && (
            <span
              className={styles.grip}
              onPointerDown={(e) => chrome.onGrab(e, chrome.id)}
              title="Drag to reorder"
              aria-label={`Drag to reorder ${title}`}
              role="button"
            >
              ⠿
            </span>
          )}
          <h2>
            {icon && <span aria-hidden="true">{icon}</span>}
            {title}
          </h2>
        </div>
        <div>
          {action}
          {chrome && (
            <button
              className={styles.remove}
              onClick={chrome.onRemove}
              title={`Remove ${title}`}
              aria-label={`Remove ${title} widget`}
            >
              ×
            </button>
          )}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

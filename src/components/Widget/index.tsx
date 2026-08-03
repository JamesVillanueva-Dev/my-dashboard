import type { ReactNode } from 'react';
import Icon, { type IconName } from '../Icon';
import { nextSize } from '../../lib/registry';
import { useWidgetChrome } from './chrome';
import styles from './styles.module.css';

/** Props for the shared {@link Widget} card wrapper. */
interface WidgetProps {
  /** Heading text shown in the card header. */
  title: string;
  /** Optional icon rendered before the title. */
  icon?: IconName;
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
  const classes = [
    styles.container,
    className,
    chrome?.size === 'compact' && styles.isCompact,
    chrome?.isDragging && styles.isDragging,
  ]
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
              onKeyDown={(e) => chrome.onGripKeyDown(e, chrome.id)}
              title="Drag, or use the arrow keys, to reorder"
              aria-label={`Reorder ${title}. Use the arrow keys to move it.`}
              role="button"
              tabIndex={0}
            >
              <Icon name="grip" />
            </span>
          )}
          <h2>
            {icon && <Icon name={icon} />}
            {title}
          </h2>
        </div>
        <div>
          {action}
          {chrome && (
            <>
              <button
                className={styles.resize}
                onClick={chrome.onResize}
                title={`Width: ${chrome.size}. Click to make it ${nextSize(chrome.size)}.`}
                aria-label={`Resize ${title}. Currently ${chrome.size}.`}
              >
                <Icon name="resize" />
              </button>
              <button
                className={styles.remove}
                onClick={chrome.onRemove}
                title={`Remove ${title}`}
                aria-label={`Remove ${title} widget`}
              >
                <Icon name="close" />
              </button>
            </>
          )}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

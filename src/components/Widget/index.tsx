import { useState, type ReactNode } from 'react';
import Icon, { type IconName } from '../Icon';
import WidgetModal from '../WidgetModal';
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
  /**
   * Offer a button that reopens this widget's body full screen, over the
   * dashboard. Worth setting for panels whose content outgrows a card — a list
   * that scrolls, or text you sit and write — and not for ones that say all they
   * have to say at card size.
   */
  expandable?: boolean;
  /** Widget body content. */
  children: ReactNode;
}

/**
 * Card shell shared by every dashboard widget. Provides the consistent header
 * (drag handle + icon + title + optional action slot + remove button) and body
 * container so individual widgets only render their own content.
 *
 * When rendered inside the dashboard grid it reads {@link useWidgetChrome} to show
 * a drag handle (for reordering), a remove button (to disable the widget), and a
 * corner handle (to resize it on both axes), and to style itself as lifted while
 * being dragged. Rendered outside the grid, those controls are simply absent.
 *
 * An `expandable` widget also gets a button that reopens its body in
 * {@link WidgetModal}, full screen over the dashboard. The body moves there
 * rather than being drawn twice, so a panel has one implementation of its
 * content shown at two sizes; the card keeps its slot in the grid so the layout
 * behind the dialog does not reflow.
 *
 * @param props - See {@link WidgetProps}.
 */
export default function Widget({
  title,
  icon,
  action,
  className,
  expandable,
  children,
}: WidgetProps) {
  const chrome = useWidgetChrome();
  const [expanded, setExpanded] = useState(false);
  // A pinned height is a fixed box, so the body has to scroll inside it; left to
  // grow, the panel is exactly as tall as its content and never needs to.
  const pinned = chrome?.size.height != null;
  const classes = [
    styles.container,
    className,
    chrome?.size.cols === 1 && styles.isCompact,
    chrome?.isDragging && styles.isDragging,
    chrome?.isResizing && styles.isResizing,
    pinned && styles.isPinned,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
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
            {expandable && (
              <button
                className={styles.expand}
                onClick={() => setExpanded(true)}
                title={`Show ${title} full screen`}
                aria-label={`Show ${title} full screen`}
              >
                <Icon name="expand" />
              </button>
            )}
            {chrome && (
              <button
                className={styles.remove}
                onClick={chrome.onRemove}
                title={`Remove ${title}`}
                aria-label={`Remove ${title} widget`}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        </header>
        {/* The body lives in one place at a time. While the dialog has it, the
            card holds its slot in the grid with a line saying where it went. */}
        <div>
          {expanded ? (
            <p className={styles.away}>
              Showing full screen.{' '}
              <button className={styles.back} onClick={() => setExpanded(false)}>
                Bring it back
              </button>
            </p>
          ) : (
            children
          )}
        </div>
        {chrome && (
          <span
            className={styles.handle}
            onPointerDown={(e) => chrome.onResizeStart(e, chrome.id)}
            onKeyDown={(e) => chrome.onResizeKeyDown(e, chrome.id)}
            onDoubleClick={() => chrome.onFitHeight(chrome.id)}
            title="Drag to resize, or use the arrow keys. Double-click to fit the height to the content."
            aria-label={`Resize ${title}. ${chrome.size.cols} ${
              chrome.size.cols === 1 ? 'column' : 'columns'
            } wide, ${
              pinned ? `${chrome.size.height} pixels tall` : 'height fits the content'
            }. Use the arrow keys to resize.`}
            role="button"
            tabIndex={0}
          />
        )}
      </section>

      {expanded && (
        <WidgetModal
          title={title}
          icon={icon}
          action={action}
          className={className}
          onClose={() => setExpanded(false)}
        >
          {children}
        </WidgetModal>
      )}
    </>
  );
}

import type { ReactNode } from 'react';
import { useWidgetChrome } from '../chrome/WidgetChrome';

/** Props for the shared {@link Widget} card wrapper. */
interface WidgetProps {
  /** Heading text shown in the card header. */
  title: string;
  /** Optional emoji/glyph rendered before the title. */
  icon?: string;
  /** Optional element rendered on the right of the header (buttons, status, etc.) */
  action?: ReactNode;
  /** Extra class name appended to the root `.widget` element. */
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
 * a drag handle (for reordering) and a remove button (to disable the widget).
 * Rendered outside the grid, those controls are simply absent.
 *
 * @param props - See {@link WidgetProps}.
 */
export default function Widget({ title, icon, action, className, children }: WidgetProps) {
  const chrome = useWidgetChrome();

  return (
    <section className={`widget${className ? ` ${className}` : ''}`}>
      <header className="widget__head">
        <div className="widget__headleft">
          {chrome && (
            <span
              className="widget__grip"
              onPointerDown={(e) => chrome.onGrab(e, chrome.id)}
              title="Drag to reorder"
              aria-label={`Drag to reorder ${title}`}
              role="button"
            >
              ⠿
            </span>
          )}
          <h2 className="widget__title">
            {icon && <span className="widget__icon" aria-hidden="true">{icon}</span>}
            {title}
          </h2>
        </div>
        <div className="widget__action">
          {action}
          {chrome && (
            <button
              className="widget__remove"
              onClick={chrome.onRemove}
              title={`Remove ${title}`}
              aria-label={`Remove ${title} widget`}
            >
              ×
            </button>
          )}
        </div>
      </header>
      <div className="widget__body">{children}</div>
    </section>
  );
}

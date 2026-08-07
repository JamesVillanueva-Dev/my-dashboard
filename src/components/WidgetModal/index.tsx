import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon, { type IconName } from '../Icon';
import { WidgetExpandedProvider } from './expanded';
import styles from './styles.module.css';

/** Props for {@link WidgetModal}. */
interface WidgetModalProps {
  /** Heading text, the same one the card header carries. */
  title: string;
  /** Optional icon rendered before the title. */
  icon?: IconName;
  /** The widget's header controls, so they stay in reach at full screen. */
  action?: ReactNode;
  /**
   * The calling widget's own root class. It lands on the dialog panel, so the
   * widget's descendant selectors (`.container li`, `.container textarea`, …)
   * style its content here exactly as they do inside the card.
   */
  className?: string;
  /** Called when the user dismisses the dialog. */
  onClose: () => void;
  /** The widget body, rendered at full size. */
  children: ReactNode;
}

/**
 * The full-screen view of a widget, shown over the dashboard.
 *
 * This is the shell alone: it renders whatever body the widget already draws,
 * given the room the card cannot spare. That is the whole point of routing it
 * through {@link Widget} rather than each widget building an expanded layout —
 * a panel has one implementation of its content, shown at two sizes.
 *
 * Rendered through a portal because the widget card it opens from is transformed
 * while being dragged, and a transformed ancestor would capture this dialog's
 * `position: fixed`.
 *
 * @param props - See {@link WidgetModalProps}.
 */
export default function WidgetModal({
  title,
  icon,
  action,
  className,
  onClose,
  children,
}: WidgetModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Open: take focus and lock the page behind the dialog. Close: give both back.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreTo?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Keeps Tab inside the dialog while it is open. */
  function onDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className={styles.container} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`${styles.panel}${className ? ` ${className}` : ''}`}
        // The hook a widget uses when its content should make use of the extra
        // room rather than merely sit in it: because the widget's root class is
        // on this same element, its stylesheet can say `.container[data-expanded]
        // textarea { … }` without reaching into this module.
        data-expanded=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <header>
          <h2 id={titleId}>
            {icon && <Icon name={icon} />}
            {title}
          </h2>
          <div className={styles.actions}>
            {action}
            <button
              className={styles.close}
              onClick={onClose}
              title={`Close ${title}`}
              aria-label={`Close ${title}`}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className={styles.body}>
          <WidgetExpandedProvider value={true}>{children}</WidgetExpandedProvider>
        </div>
      </div>
    </div>,
    document.body,
  );
}

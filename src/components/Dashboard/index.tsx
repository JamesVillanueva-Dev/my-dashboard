import { useState } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useWidgetLayout } from '../../hooks/useWidgetLayout';
import LegalModal, { type LegalDoc } from '../LegalModal';
import { WidgetChromeProvider } from '../Widget/chrome';
import Header from '../Header';
import Greeting from '../Greeting';
import TodayPanel from '../TodayPanel';
import Footer from '../Footer';
import WidgetMenu from '../WidgetMenu';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';
import { useSyncStatus } from '../../hooks/useProfileSync';
import { widgetById } from '../../lib/registry';
import styles from './styles.module.css';

/**
 * Root of the dashboard: the page around the widget grid, and the grid itself.
 *
 * Everything about *where* a panel sits and how big it is — the persisted order,
 * the drag-to-reorder and drag-to-resize gestures, and their keyboard
 * equivalents — belongs to {@link useWidgetLayout}. What is left here is the
 * page: the header, the Today zone, the grid's elements, and the user's name,
 * which is persisted so the greeting survives reloads.
 */
export default function Dashboard() {
  const sync = useSyncStatus();
  const [name, setName] = useLocalStorage<string>('user.name', '');
  const [showFocus, setShowFocus] = useLocalStorage<boolean>('today.showFocus', true);
  const [legal, setLegal] = useState<LegalDoc>(null);
  const {
    enabled,
    gridRef,
    registerItem,
    dragId,
    resizeId,
    announcement,
    toggle,
    reset,
    chromeFor,
  } = useWidgetLayout();

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
                    ref={registerItem(id)}
                    className={`${styles.item}${dragId === id ? ` ${styles.isDragging}` : ''}`}
                  >
                    <WidgetChromeProvider value={chromeFor(id)}>{def.render()}</WidgetChromeProvider>
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

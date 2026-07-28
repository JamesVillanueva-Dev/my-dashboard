import { createContext, useContext, type PointerEvent } from 'react';

/**
 * Chrome (management controls) injected around each widget by the dashboard grid.
 * A widget's {@link Widget} shell reads this to render its drag handle and remove
 * button, so individual widget components don't need to know about layout at all.
 */
export interface WidgetChrome {
  /** Stable id of the widget instance, used for reordering and removal. */
  id: string;
  /** Removes (disables) this widget from the dashboard. */
  onRemove: () => void;
  /** Begins a pointer-based drag from this widget's handle. */
  onGrab: (e: PointerEvent, id: string) => void;
  /** Whether this widget is the one currently being dragged. */
  isDragging: boolean;
}

const WidgetChromeContext = createContext<WidgetChrome | null>(null);

export const WidgetChromeProvider = WidgetChromeContext.Provider;

/**
 * Reads the surrounding {@link WidgetChrome}, if any.
 *
 * @returns The chrome for the current widget, or `null` when a widget is rendered
 *   outside the dashboard grid (e.g. in isolation during tests).
 */
export function useWidgetChrome(): WidgetChrome | null {
  return useContext(WidgetChromeContext);
}

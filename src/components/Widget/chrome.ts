import { createContext, useContext, type KeyboardEvent, type PointerEvent } from 'react';
import type { WidgetSize } from '../../lib/registry';

/**
 * Chrome (management controls) injected around each widget by the dashboard grid.
 * A widget's {@link Widget} shell reads this to render its drag handle and remove
 * button, so individual widget components don't need to know about layout at all.
 */
export interface WidgetChrome {
  /** Stable id of the widget instance, used for reordering and removal. */
  id: string;
  /** Current width and height of this panel; the width also drives its density. */
  size: WidgetSize;
  /** Begins a pointer drag from the corner handle, resizing on both axes at once. */
  onResizeStart: (e: PointerEvent, id: string) => void;
  /**
   * Arrow-key resizing from the corner handle — the keyboard equivalent of that
   * drag, since a pointer drag is otherwise the only way to set a size.
   */
  onResizeKeyDown: (e: KeyboardEvent, id: string) => void;
  /** Unpins the height so the panel goes back to growing with its content. */
  onFitHeight: (id: string) => void;
  /** Removes (disables) this widget from the dashboard. */
  onRemove: () => void;
  /** Begins a pointer-based drag from this widget's handle. */
  onGrab: (e: PointerEvent, id: string) => void;
  /**
   * Arrow-key reordering from the handle — the keyboard equivalent of a drag.
   * Without it the layout could only be rearranged with a pointer.
   */
  onGripKeyDown: (e: KeyboardEvent, id: string) => void;
  /** Whether this widget is the one currently being dragged. */
  isDragging: boolean;
  /** Whether this widget is the one currently being resized. */
  isResizing: boolean;
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

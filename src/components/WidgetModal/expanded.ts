import { createContext, useContext } from 'react';

/**
 * Whether the surrounding widget body is the full-screen copy of itself.
 *
 * The card and the dialog render the *same* body — that is the point of routing
 * expansion through {@link Widget} — so a widget with something extra worth
 * showing only at full size needs to be told which one it is in. Everything a
 * panel always shows should ignore this: it exists for the material a card has
 * no room for, not for building two different widgets.
 */
const WidgetExpandedContext = createContext(false);

/**
 * Marks its subtree as the expanded copy. {@link WidgetModal} wraps the body in
 * this; nothing else should.
 */
export const WidgetExpandedProvider = WidgetExpandedContext.Provider;

/**
 * Reads whether this render of a widget body is the full-screen one.
 *
 * @returns `true` inside {@link WidgetModal}, and `false` in the card — which is
 *   also what a widget rendered outside the dashboard entirely will see.
 */
export function useWidgetExpanded(): boolean {
  return useContext(WidgetExpandedContext);
}

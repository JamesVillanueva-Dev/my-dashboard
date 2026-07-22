import type { ReactNode } from 'react';
import WeatherWidget from '../components/WeatherWidget';
import NewsWidget from '../components/NewsWidget';
import NotesWidget from '../components/NotesWidget';
import RemindersWidget from '../components/RemindersWidget';
import TodoWidget from '../components/TodoWidget';
import QuickLinksWidget from '../components/QuickLinksWidget';
import FocusWidget from '../components/FocusWidget';

/** A dashboard widget that can be enabled, disabled, and reordered. */
export interface WidgetDef {
  /** Stable id persisted in the saved layout. Never change once shipped. */
  id: string;
  /** Human label shown in the widget menu. */
  title: string;
  /** Emoji shown beside the label in the menu. */
  icon: string;
  /** Renders the widget. */
  render: () => ReactNode;
}

/**
 * The catalogue of every available widget, in the order they appear by default.
 * The dashboard's saved layout references these by `id`; anything present here
 * but absent from the saved layout shows up in the menu as available to add.
 */
export const WIDGETS: WidgetDef[] = [
  { id: 'focus', title: 'Focus of the Day', icon: '🎯', render: () => <FocusWidget /> },
  { id: 'weather', title: 'Weather', icon: '🌦️', render: () => <WeatherWidget /> },
  { id: 'reminders', title: 'Reminders', icon: '⏰', render: () => <RemindersWidget /> },
  { id: 'todo', title: 'To-do', icon: '✅', render: () => <TodoWidget /> },
  { id: 'news', title: 'News', icon: '📰', render: () => <NewsWidget /> },
  { id: 'notes', title: 'Notes', icon: '📝', render: () => <NotesWidget /> },
  { id: 'quicklinks', title: 'Quick Links', icon: '🔗', render: () => <QuickLinksWidget /> },
];

/** Default layout: every widget, in catalogue order. */
export const DEFAULT_LAYOUT: string[] = WIDGETS.map((w) => w.id);

/** Look up a widget definition by id. */
export function widgetById(id: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.id === id);
}

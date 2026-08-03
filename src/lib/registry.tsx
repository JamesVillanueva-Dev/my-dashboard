import type { ReactNode } from 'react';
import type { IconName } from '../components/Icon';
import WeatherWidget from '../components/WeatherWidget';
import CalendarWidget from '../components/CalendarWidget';
import RemindersWidget from '../components/RemindersWidget';
import NewsWidget from '../components/NewsWidget';
import NotesWidget from '../components/NotesWidget';
import QuickLinksWidget from '../components/QuickLinksWidget';
import SpotifyWidget from '../components/SpotifyWidget';

/**
 * How wide a panel is, in grid columns.
 *
 * - `compact` — one column. Reference material you glance at; also gets tighter
 *   padding and a smaller type scale.
 * - `standard` — two columns. A surface you act on.
 * - `wide` — three columns, for a panel with a lot to say.
 *
 * The registry value is only the *default*: every panel can be resized from its
 * header, and the choice persists per widget. There is no `hero` size — the lead
 * zone is `TodayPanel`, part of the dashboard frame rather than this catalogue.
 */
export type WidgetSize = 'compact' | 'standard' | 'wide';

/** The order the header's resize control cycles through. */
export const WIDGET_SIZES: WidgetSize[] = ['compact', 'standard', 'wide'];

/** Columns each size occupies in the dashboard grid. */
export const SIZE_COLUMNS: Record<WidgetSize, number> = {
  compact: 1,
  standard: 2,
  wide: 3,
};

/** The next size in the cycle, wrapping back to the start. */
export function nextSize(size: WidgetSize): WidgetSize {
  return WIDGET_SIZES[(WIDGET_SIZES.indexOf(size) + 1) % WIDGET_SIZES.length];
}

/** A dashboard widget that can be enabled, disabled, and reordered. */
export interface WidgetDef {
  /** Stable id persisted in the saved layout. Never change once shipped. */
  id: string;
  /** Human label shown in the widget menu and the panel header. */
  title: string;
  /** Icon shown beside the label in the menu and the widget header. */
  icon: IconName;
  /** Default width — see {@link WidgetSize}. The user can override it per panel. */
  size: WidgetSize;
  /** Renders the widget. */
  render: () => ReactNode;
}

/**
 * The catalogue of every available widget, in the order they appear by default.
 * The dashboard's saved layout references these by `id`; anything present here
 * but absent from the saved layout shows up in the menu as available to add.
 *
 * Standard-size widgets lead, so the default layout reads top-down in order of
 * how much of your attention the panel deserves.
 *
 * Two ids are deliberately absent and will be filtered out of any saved layout
 * that still contains them:
 * - `todo` — merged into `reminders`, which is now the single task list.
 * - `focus` — moved into the Today zone, where the day's one intention belongs.
 */
export const WIDGETS: WidgetDef[] = [
  { id: 'reminders', title: 'Tasks', icon: 'checkSquare', size: 'standard', render: () => <RemindersWidget /> },
  { id: 'calendar', title: 'Calendar', icon: 'calendar', size: 'standard', render: () => <CalendarWidget /> },
  { id: 'weather', title: 'Weather', icon: 'cloudSun', size: 'compact', render: () => <WeatherWidget /> },
  { id: 'news', title: 'News', icon: 'newspaper', size: 'standard', render: () => <NewsWidget /> },
  { id: 'notes', title: 'Notes', icon: 'note', size: 'compact', render: () => <NotesWidget /> },
  { id: 'quicklinks', title: 'Quick Links', icon: 'link', size: 'compact', render: () => <QuickLinksWidget /> },
  { id: 'spotify', title: 'Spotify', icon: 'music', size: 'compact', render: () => <SpotifyWidget /> },
];

/** Default layout: every widget, in catalogue order. */
export const DEFAULT_LAYOUT: string[] = WIDGETS.map((w) => w.id);

/** Look up a widget definition by id. */
export function widgetById(id: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.id === id);
}

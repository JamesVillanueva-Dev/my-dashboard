import type { ReactNode } from 'react';
import type { IconName } from '../components/Icon';
import WeatherWidget from '../components/WeatherWidget';
import CalendarWidget from '../components/CalendarWidget';
import RemindersWidget from '../components/RemindersWidget';
import NewsWidget from '../components/NewsWidget';
import NotesWidget from '../components/NotesWidget';
import SpotifyWidget from '../components/SpotifyWidget';
import YouTubeWidget from '../components/YouTubeWidget';
import MailWidget from '../components/MailWidget';
import ClassNotes from '../components/ClassNotes';

/**
 * How big a panel is. Both axes are set by dragging the handle in the panel's
 * bottom-right corner, and the choice persists per widget.
 *
 * Both axes snap, because the dashboard is a column grid and panels are meant to
 * line up: width to a whole number of columns, height to {@link HEIGHT_SNAP}.
 *
 * A one-column panel also gets tighter padding and a smaller type scale, so
 * reference material you only glance at never competes with a panel you act on.
 */
export interface WidgetSize {
  /** Width in grid columns. Clamped to the columns the grid actually has. */
  cols: number;
  /** Pinned height in px, or `null` to grow with the content. */
  height: number | null;
}

/** Narrowest a panel can be dragged: one column. */
export const MIN_COLS = 1;
/**
 * Widest a panel can be dragged. The grid rarely fits this many columns; it is
 * the ceiling for the *stored* width, so a panel sized on a wide monitor keeps
 * its intent after the window shrinks and grows again.
 */
export const MAX_COLS = 6;

/** Shortest a panel can be dragged, in px — below this the header crowds out the body. */
export const MIN_HEIGHT = 120;
/** Tallest a panel can be dragged, in px. */
export const MAX_HEIGHT = 1200;
/**
 * The px grid heights snap to.
 *
 * Exact-pixel heights made two panels match only by luck: landing on the same
 * number by hand meant pixel-hunting a drag. Snapping to a step coarse enough to
 * feel means dragging one panel roughly level with another lands it *exactly*
 * level. {@link MIN_HEIGHT} and {@link MAX_HEIGHT} are both multiples of it, so
 * clamping can never knock a height back off the step.
 */
export const HEIGHT_SNAP = 10;

/** Columns each pre-resize size name occupied, for reading older saved layouts. */
const LEGACY_COLUMNS: Record<string, number> = { compact: 1, standard: 2, wide: 3 };

/** Confines a dragged column count to what the grid can show. */
export function clampCols(cols: number, max: number = MAX_COLS): number {
  return Math.min(Math.max(Math.round(cols), MIN_COLS), Math.max(MIN_COLS, Math.min(max, MAX_COLS)));
}

/** Snaps a dragged height to {@link HEIGHT_SNAP} and confines it to the usable range. */
export function clampHeight(height: number): number {
  const snapped = Math.round(height / HEIGHT_SNAP) * HEIGHT_SNAP;
  return Math.min(Math.max(snapped, MIN_HEIGHT), MAX_HEIGHT);
}

/**
 * Reads one entry out of the persisted size map.
 *
 * Panels used to be sized by a button that cycled three named widths, so a saved
 * map from an older version holds strings where this one holds shapes. Those are
 * translated to their column count rather than discarded, and anything else falls
 * back to the widget's registry default.
 *
 * @param stored - The raw persisted value for this widget, if any.
 * @param cols - The widget's default width, used when the value is missing or junk.
 */
export function normalizeSize(stored: unknown, cols: number): WidgetSize {
  if (typeof stored === 'string') return { cols: LEGACY_COLUMNS[stored] ?? cols, height: null };
  if (stored && typeof stored === 'object') {
    const { cols: c, height: h } = stored as Partial<WidgetSize>;
    return {
      cols: clampCols(typeof c === 'number' && Number.isFinite(c) ? c : cols),
      height: typeof h === 'number' && Number.isFinite(h) ? clampHeight(h) : null,
    };
  }
  return { cols: clampCols(cols), height: null };
}

/** A dashboard widget that can be enabled, disabled, and reordered. */
export interface WidgetDef {
  /** Stable id persisted in the saved layout. Never change once shipped. */
  id: string;
  /** Human label shown in the widget menu and the panel header. */
  title: string;
  /** Icon shown beside the label in the menu and the widget header. */
  icon: IconName;
  /** Default width in grid columns. The user can resize any panel from its corner. */
  cols: number;
  /**
   * Leave the widget out of {@link DEFAULT_LAYOUT}. It still appears in the
   * widget menu, ready to be switched on — this only decides whether a dashboard
   * that has never been arranged starts with it.
   */
  defaultOff?: boolean;
  /** Renders the widget. */
  render: () => ReactNode;
}

/**
 * The catalogue of every available widget, in the order they appear by default.
 * The dashboard's saved layout references these by `id`; anything present here
 * but absent from the saved layout shows up in the menu as available to add.
 *
 * Wider widgets lead, so the default layout reads top-down in order of how much
 * of your attention the panel deserves.
 *
 * Three ids are deliberately absent and will be filtered out of any saved layout
 * that still contains them:
 * - `todo` — merged into `reminders`, which is now the single task list.
 * - `focus` — moved into the Today zone, where the day's one intention belongs.
 * - `quicklinks` — moved into the nav bar, where navigation is always in reach.
 */
export const WIDGETS: WidgetDef[] = [
  { id: 'reminders', title: 'Tasks', icon: 'checkSquare', cols: 2, render: () => <RemindersWidget /> },
  { id: 'calendar', title: 'Calendar', icon: 'calendar', cols: 2, render: () => <CalendarWidget /> },
  { id: 'weather', title: 'Weather', icon: 'cloudSun', cols: 1, render: () => <WeatherWidget /> },
  { id: 'classes', title: 'Classes', icon: 'book', cols: 2, render: () => <ClassNotes /> },
  { id: 'news', title: 'News', icon: 'newspaper', cols: 2, render: () => <NewsWidget /> },
  { id: 'notes', title: 'Notes', icon: 'note', cols: 1, render: () => <NotesWidget /> },
  { id: 'youtube', title: 'YouTube', icon: 'video', cols: 2, render: () => <YouTubeWidget /> },
  {
    id: 'mail',
    title: 'Mail',
    icon: 'mail',
    cols: 2,
    // Off until switched on. It no longer needs an API key (ADR 0010), but
    // `gmail.readonly` is a Google *restricted* scope and reading someone's
    // inbox is the most invasive thing this app can do — not something to turn
    // on for them without their say-so.
    defaultOff: true,
    render: () => <MailWidget />,
  },
  {
    id: 'spotify',
    title: 'Spotify',
    icon: 'music',
    cols: 1,
    // YouTube is the music panel a fresh dashboard shows: it plays full tracks
    // with no account at all, where Spotify's embed serves 30-second previews
    // until you are logged in and needs Premium for anything better (ADR 0007).
    defaultOff: true,
    render: () => <SpotifyWidget />,
  },
];

/** Default layout: every widget that isn't opt-in, in catalogue order. */
export const DEFAULT_LAYOUT: string[] = WIDGETS.filter((w) => !w.defaultOff).map((w) => w.id);

/** Look up a widget definition by id. */
export function widgetById(id: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.id === id);
}

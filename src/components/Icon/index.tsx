import styles from './styles.module.css';

/* ---------- Widgets ---------- */
import target from './icons/target.svg?raw';
import calendar from './icons/calendar.svg?raw';
import calendarCheck from './icons/calendarCheck.svg?raw';
import alarm from './icons/alarm.svg?raw';
import checkSquare from './icons/checkSquare.svg?raw';
import newspaper from './icons/newspaper.svg?raw';
import note from './icons/note.svg?raw';
import link from './icons/link.svg?raw';
import music from './icons/music.svg?raw';
import mail from './icons/mail.svg?raw';
import video from './icons/video.svg?raw';
/** Stacked lines with a play triangle: a queue of videos, i.e. a playlist. */
import list from './icons/list.svg?raw';

/* ---------- Weather conditions (WMO codes) ---------- */
import sun from './icons/sun.svg?raw';
import cloudSun from './icons/cloudSun.svg?raw';
import cloud from './icons/cloud.svg?raw';
import cloudFog from './icons/cloudFog.svg?raw';
import cloudDrizzle from './icons/cloudDrizzle.svg?raw';
import cloudRain from './icons/cloudRain.svg?raw';
import cloudSnow from './icons/cloudSnow.svg?raw';
import cloudLightning from './icons/cloudLightning.svg?raw';
import thermometer from './icons/thermometer.svg?raw';
import droplet from './icons/droplet.svg?raw';
import wind from './icons/wind.svg?raw';
import pin from './icons/pin.svg?raw';

/* ---------- Interface ---------- */
import grid from './icons/grid.svg?raw';
import settings from './icons/settings.svg?raw';
/** Stands in for "whatever the operating system is set to". */
import monitor from './icons/monitor.svg?raw';
/** "Your data is safe here" — the footer's local-first badge. */
import shield from './icons/shield.svg?raw';
import close from './icons/close.svg?raw';
import expand from './icons/expand.svg?raw';
/** Horizontal resize: a panel edge with arrows pointing out either side. */
import resize from './icons/resize.svg?raw';
import chevronLeft from './icons/chevronLeft.svg?raw';
import chevronRight from './icons/chevronRight.svg?raw';

/* ---------- Media transport (Spotify player) ---------- */
import play from './icons/play.svg?raw';
import pause from './icons/pause.svg?raw';
import skipBack from './icons/skipBack.svg?raw';
import skipForward from './icons/skipForward.svg?raw';
/** Speaker with two arcs; the muted variant swaps them for a cross. */
import volume from './icons/volume.svg?raw';
import volumeMute from './icons/volumeMute.svg?raw';
import plus from './icons/plus.svg?raw';
import check from './icons/check.svg?raw';
import refresh from './icons/refresh.svg?raw';
/** Dots rather than strokes, so this one opts out of the shared stroke. */
import grip from './icons/grip.svg?raw';

/**
 * The icon set: one `.svg` file per glyph in `./icons`, drawn as 24×24 stroked
 * outlines on a shared grid.
 *
 * Each file is a standalone SVG that stands on its own in a browser or a design
 * tool, and every glyph inherits `currentColor` and a common stroke weight, so an
 * icon always matches the text it sits beside — that is the whole reason these
 * replaced emoji, which ignore colour and render differently on every platform.
 * Keep new files stroke-only (no `fill`) so they stay consistent; the dot-based
 * grip glyph opts out explicitly.
 *
 * Adding an icon is two lines: drop the file in `./icons` and list it here.
 */
const FILES = {
  target,
  calendar,
  calendarCheck,
  alarm,
  checkSquare,
  newspaper,
  note,
  link,
  music,
  mail,
  video,
  list,
  sun,
  cloudSun,
  cloud,
  cloudFog,
  cloudDrizzle,
  cloudRain,
  cloudSnow,
  cloudLightning,
  thermometer,
  droplet,
  wind,
  pin,
  grid,
  settings,
  monitor,
  shield,
  close,
  expand,
  resize,
  chevronLeft,
  chevronRight,
  play,
  pause,
  skipBack,
  skipForward,
  volume,
  volumeMute,
  plus,
  check,
  refresh,
  grip,
} satisfies Record<string, string>;

/** Every icon available to {@link Icon}. */
export type IconName = keyof typeof FILES;

/**
 * The drawing inside a file's `<svg>` root, which {@link Icon} re-parents into
 * its own root element.
 *
 * The files carry a full `<svg …>` wrapper so each one is valid on its own, but
 * that wrapper's `viewBox`/stroke attributes are exactly what `Icon` already
 * sets — keeping the file's would mean a nested `<svg>` and a second set of
 * attributes to keep in sync.
 */
function glyph(file: string): string {
  return file
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
}

/** Name → drawing, stripped once at module load rather than on every render. */
const ICONS = Object.fromEntries(
  Object.entries(FILES).map(([name, file]) => [name, glyph(file)]),
) as Record<IconName, string>;

/** Props for {@link Icon}. */
interface IconProps {
  /** Which glyph to draw. */
  name: IconName;
  /**
   * Width and height. Defaults to `1em`, so an icon scales with whatever font
   * size its container sets and needs no styling at the call site.
   */
  size?: number | string;
  /**
   * Accessible name. Omit for decorative icons — the default — which are hidden
   * from assistive tech because the surrounding button or text already names them.
   */
  label?: string;
}

/**
 * Renders one glyph from the app's icon set as an inline SVG.
 *
 * Inline rather than an `<img>`, an icon font, or a sprite sheet: the glyphs are
 * bundled as text at build time, which keeps the app dependency free and offline
 * (ADR 0001) and lets each one inherit colour from its context so icons theme
 * themselves. The markup comes from local files under `./icons`, never from user
 * or network input.
 *
 * @param props - See {@link IconProps}.
 */
export default function Icon({ name, size = '1em', label }: IconProps) {
  return (
    <svg
      className={styles.container}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

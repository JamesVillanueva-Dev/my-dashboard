import { useState } from 'react';
import Icon from '../Icon';
import { useDismiss } from '../../hooks/useDismiss';
import { useTheme } from '../../hooks/useTheme';
import { THEMES, themeById } from '../../lib/themes';
import type { Theme } from '../../lib/themes';
import styles from './styles.module.css';

/**
 * A theme's two-tone dot: the page background with the accent as its right half.
 *
 * Drawn as an inline SVG because the colours are per-theme data rather than
 * design tokens — the picker shows every palette at once, and CSS custom
 * properties only ever resolve to the *active* one. SVG presentation attributes
 * keep that data-driven fill out of a `style` attribute.
 *
 * @param props.theme - The theme to draw.
 */
function Swatch({ theme }: { theme: Theme }) {
  return (
    <svg className={styles.swatch} viewBox="0 0 16 16" width="1.15em" height="1.15em" aria-hidden>
      <circle cx="8" cy="8" r="7" fill={theme.bg} />
      <path d="M8 1a7 7 0 0 1 0 14Z" fill={theme.accent} />
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25" />
    </svg>
  );
}

/**
 * The dashboard's settings menu: a header dropdown holding the colour-scheme
 * picker. Closes on outside click or Escape.
 *
 * The themes are a single radio group whose value is the stored *preference*,
 * so "Follow system" is one of the options rather than a separate switch — it
 * is a peer choice, not a modifier on top of a chosen palette.
 */
export default function Settings() {
  const { preference, setPreference, system } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div className={styles.container} ref={ref}>
      <button
        className={styles.button}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
      >
        <Icon name="settings" /> Settings
      </button>
      {open && (
        <div role="menu">
          <p id="appearance-heading">Appearance</p>
          <ul aria-labelledby="appearance-heading">
            {THEMES.map((t) => (
              <li key={t.id}>
                <label>
                  <input
                    type="radio"
                    name="theme"
                    checked={preference === t.id}
                    onChange={() => setPreference(t.id)}
                  />
                  <Swatch theme={t} />
                  {t.label}
                  <small>{t.mode}</small>
                </label>
              </li>
            ))}
          </ul>
          <ul>
            <li>
              <label>
                <input
                  type="radio"
                  name="theme"
                  checked={preference === 'system'}
                  onChange={() => setPreference('system')}
                />
                <Icon name="monitor" />
                Follow system
                {/* The mode rather than the palette name, matching the hint on
                    every row above and reading as "your OS is light right now". */}
                <small>{themeById(system).mode}</small>
              </label>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

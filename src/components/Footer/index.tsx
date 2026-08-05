import Icon from '../Icon';
import type { LegalDoc } from '../LegalModal';
import styles from './styles.module.css';

/** A live service the dashboard reads from, and what it feeds. */
interface Source {
  label: string;
  /** What it powers, shown after the name. */
  role: string;
  /** Home page, when there is a meaningful one to link to. */
  href?: string;
}

const SOURCES: Source[] = [
  { label: 'Open-Meteo', role: 'weather', href: 'https://open-meteo.com' },
  { label: 'Public RSS', role: 'headlines' },
  { label: 'YouTube', role: 'player', href: 'https://www.youtube.com' },
  { label: 'Spotify', role: 'optional player', href: 'https://open.spotify.com' },
  { label: 'Gmail', role: 'mail, read-only', href: 'https://mail.google.com' },
  { label: 'Claude', role: 'mail ranking', href: 'https://claude.com' },
];

/** Props for {@link Footer}. */
interface FooterProps {
  /** Opens one of the legal documents in the modal the dashboard owns. */
  onOpenLegal: (doc: NonNullable<LegalDoc>) => void;
}

/**
 * The page's closing band: what this app is, the third-party services it reads
 * from, and the legal documents.
 *
 * Deliberately quiet — muted text, no card, no accent fills beyond the mark and
 * the badge glyph. It reads as the floor of the page rather than one more panel
 * competing with the grid above it, which is the whole reason the separating
 * rule fades out at both ends instead of running edge to edge.
 *
 * The attributions are not decoration: the Privacy Policy names these same
 * services as the only places a request leaves the browser for, so the footer is
 * where that claim is visible without opening the document.
 *
 * @param props - See {@link FooterProps}.
 */
export default function Footer({ onOpenLegal }: FooterProps) {
  return (
    <footer className={styles.container}>
      <div className={styles.brand}>
        <p className={styles.name}>
          <span>
            <Icon name="grid" />
          </span>
          Dashboard
        </p>
        <p>Your day in one place — no account, no server, nothing to sign up for.</p>
        <p className={styles.badge}>
          <Icon name="shield" />
          No analytics, no ads, no tracking
        </p>
      </div>

      <nav className={styles.group} aria-label="Data sources">
        <p>Sources</p>
        <ul>
          {SOURCES.map((s) => (
            <li key={s.label}>
              {s.href ? (
                <a href={s.href} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              ) : (
                <span>{s.label}</span>
              )}
              <span>{s.role}</span>
            </li>
          ))}
        </ul>
      </nav>

      <nav className={styles.group} aria-label="Legal">
        <p>Legal</p>
        <ul>
          <li>
            <button onClick={() => onOpenLegal('privacy')}>Privacy Policy</button>
          </li>
          <li>
            <button onClick={() => onOpenLegal('terms')}>Terms of Service</button>
          </li>
        </ul>
      </nav>
    </footer>
  );
}

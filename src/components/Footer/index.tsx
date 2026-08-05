import type { LegalDoc } from '../LegalModal';
import styles from './styles.module.css';

/** A live service the dashboard reads from, and what it feeds. */
interface Source {
  /** The service's name. */
  label: string;
  /** What it powers. Carried on the item's `title` rather than set in type — the
   *  annotation is worth having on hover, not worth a column. */
  role: string;
  /** Home page, when there is a meaningful one to link to. */
  href?: string;
}

/**
 * Every service the dashboard can reach out to. This list and the Privacy
 * Policy's are the same claim, so anything added here that makes a network
 * request belongs in that document too.
 */
const SOURCES: Source[] = [
  { label: 'Open-Meteo', role: 'weather', href: 'https://open-meteo.com' },
  { label: 'Public RSS', role: 'headlines' },
  { label: 'YouTube', role: 'player', href: 'https://www.youtube.com' },
  { label: 'Spotify', role: 'optional player', href: 'https://open.spotify.com' },
  { label: 'Gmail', role: 'mail, read-only', href: 'https://mail.google.com' },
];

/** Props for {@link Footer}. */
interface FooterProps {
  /** Opens one of the legal documents in the modal the dashboard owns. */
  onOpenLegal: (doc: NonNullable<LegalDoc>) => void;
}

/**
 * The page's closing band: what this app is, what it talks to, and the legal
 * documents — in two quiet rows.
 *
 * Everything here is type and spacing. No card, no accent fills, no icons, no
 * section labels: the footer should read as the floor of the page rather than
 * one more panel competing with the grid above it, which is also why the
 * separating rule fades out at both ends instead of running edge to edge.
 *
 * The attributions are not decoration. The Privacy Policy names these same
 * services as the only places a request leaves the browser for, so the footer is
 * where that claim stays visible without opening the document — which is why
 * they survived the strip-back as a middot run rather than being dropped.
 *
 * @param props - See {@link FooterProps}.
 */
export default function Footer({ onOpenLegal }: FooterProps) {
  return (
    <footer className={styles.container}>
      <p className={styles.brand}>
        <strong>Dashboard</strong>
        <span>Your day in one place</span>
      </p>

      {/* This line once read "Everything stays in this browser", and was weakened
          when mail ranking started calling Anthropic. That call is gone
          (ADR 0010) — but the stronger claim is still not restored, because it
          was already overclaiming before mail existed: signing in mirrors your
          dashboard to Clerk (ADR 0008), and "use my location" sends coordinates
          to Open-Meteo. What is written here is true unconditionally, which is
          the bar for a claim nobody clicks. */}
      <p className={styles.promise}>No analytics, no ads, no tracking</p>

      {/* One row holding both runs, so they sit shoulder to shoulder at desktop
          and stack on a phone. A positional selector on `.container` would do
          the same job far more fragilely. */}
      <div className={styles.meta}>
        <nav aria-label="Data sources">
          <ul>
            {SOURCES.map((s) => (
              <li key={s.label}>
                {s.href ? (
                  <a href={s.href} target="_blank" rel="noreferrer" title={s.role}>
                    {s.label}
                  </a>
                ) : (
                  <span title={s.role}>{s.label}</span>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Legal">
          <ul>
            <li>
              <button onClick={() => onOpenLegal('privacy')}>Privacy Policy</button>
            </li>
            <li>
              <button onClick={() => onOpenLegal('terms')}>Terms of Service</button>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

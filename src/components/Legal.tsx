import { useEffect } from 'react';

/** Which legal document to show, or `null` for none. */
export type LegalDoc = 'privacy' | 'terms' | null;

const LAST_UPDATED = 'July 22, 2026';

/** The Privacy Policy body. Describes the app's actual, local-first behaviour. */
function PrivacyPolicy() {
  return (
    <>
      <h2>Privacy Policy</h2>
      <p className="legal__meta">Last updated: {LAST_UPDATED}</p>

      <h3>The short version</h3>
      <p>
        This dashboard runs entirely in your browser. It has no user accounts and no
        server that stores your data. Everything you enter stays on your device.
      </p>

      <h3>What we store, and where</h3>
      <p>
        Your notes, reminders, to-dos, quick links, focus text, chosen widgets and
        layout, display name, theme, and weather location are saved in your browser's{' '}
        <code>localStorage</code>. They never leave your device through us and are
        removed if you clear your browser data.
      </p>

      <h3>Third-party services we contact</h3>
      <p>To provide live content, your browser makes requests directly to:</p>
      <ul>
        <li>
          <strong>Open-Meteo</strong> — weather and city search. If you use “my
          location,” your browser's coordinates are sent to fetch local weather.
        </li>
        <li>
          <strong>allorigins.win</strong> — a proxy used to fetch public news RSS
          feeds, plus the feed publishers themselves (e.g. BBC, NPR, Hacker News).
        </li>
        <li>
          <strong>Google's favicon service</strong> — to show icons for your quick
          links.
        </li>
      </ul>
      <p>
        These providers may receive your IP address and request details as part of
        normal internet requests, and each has its own privacy practices. We do not
        control them and do not send them your personal dashboard content.
      </p>

      <h3>Analytics &amp; tracking</h3>
      <p>We include no analytics, advertising, or third-party tracking cookies.</p>

      <h3>Your control</h3>
      <p>
        You can delete any item in the app, remove widgets, or clear your browser's
        site data to erase everything at once.
      </p>

      <p className="legal__note">
        This is a sample policy for a personal project and is not legal advice.
      </p>
    </>
  );
}

/** The Terms of Service body. */
function TermsOfService() {
  return (
    <>
      <h2>Terms of Service</h2>
      <p className="legal__meta">Last updated: {LAST_UPDATED}</p>

      <h3>Acceptance</h3>
      <p>By using this dashboard, you agree to these terms.</p>

      <h3>The service</h3>
      <p>
        This is a free, personal productivity dashboard provided “as is,” without
        warranties of any kind. Features may change or be removed at any time.
      </p>

      <h3>Your data &amp; responsibility</h3>
      <p>
        Your data is stored only in your browser. You are responsible for it,
        including any loss from clearing browser data, browser limits, or device
        issues. Keep your own backups of anything important.
      </p>

      <h3>Third-party content</h3>
      <p>
        Weather, news headlines, and link icons come from third-party services. We
        don't control and aren't responsible for the accuracy, availability, or
        content of those services, and their use may be subject to their own terms.
      </p>

      <h3>Acceptable use</h3>
      <p>
        Don't use the app unlawfully or attempt to disrupt the third-party services
        it relies on.
      </p>

      <h3>Limitation of liability</h3>
      <p>
        To the maximum extent permitted by law, the authors are not liable for any
        damages arising from your use of the app, including lost data.
      </p>

      <p className="legal__note">
        This is a sample document for a personal project and is not legal advice.
      </p>
    </>
  );
}

/** Props for {@link LegalModal}. */
interface LegalModalProps {
  /** Which document to display, or `null` to render nothing. */
  doc: LegalDoc;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
}

/**
 * Accessible modal dialog that shows the Privacy Policy or Terms of Service.
 * Closes on the Escape key, a click on the backdrop, or the close button.
 *
 * @param props - See {@link LegalModalProps}.
 */
export default function LegalModal({ doc, onClose }: LegalModalProps) {
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [doc, onClose]);

  if (!doc) return null;

  return (
    <div className="legal__backdrop" onClick={onClose}>
      <div
        className="legal__modal"
        role="dialog"
        aria-modal="true"
        aria-label={doc === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="legal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="legal__content">
          {doc === 'privacy' ? <PrivacyPolicy /> : <TermsOfService />}
        </div>
      </div>
    </div>
  );
}

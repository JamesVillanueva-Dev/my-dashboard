import { useState } from 'react';
import Icon, { type IconName } from '../Icon';
import Footer from '../Footer';
import LegalModal, { type LegalDoc } from '../LegalModal';
import { useTheme } from '../../hooks/useTheme';
import styles from './styles.module.css';

/** One panel described in the feature grid. */
interface Feature {
  /** Icon from the shared set. */
  icon: IconName;
  /** Panel name, as it appears on the dashboard. */
  title: string;
  /** What it actually does — specific, not a slogan. */
  body: string;
}

/**
 * The widgets, described by what they do rather than by what they are called.
 *
 * Everything claimed here is something the dashboard genuinely does; a landing
 * page that oversells is a bug report waiting to be filed.
 */
const FEATURES: Feature[] = [
  {
    icon: 'checkSquare',
    title: 'Tasks',
    body: 'A single list with optional due dates. Connect Google Calendar and each dated task becomes a real event, edited in either place and reconciled both ways.',
  },
  {
    icon: 'calendar',
    title: 'Calendar',
    body: 'Your month at a glance, reading every calendar you have. Create, edit and delete events without leaving the page.',
  },
  {
    icon: 'cloudSun',
    title: 'Weather',
    body: 'Current conditions and a four-day outlook from Open-Meteo. Search any city, or use your location — no API key to sign up for.',
  },
  {
    icon: 'newspaper',
    title: 'News',
    body: 'Headlines from public RSS feeds, with BBC, NPR and Hacker News built in. Add any feed URL you like.',
  },
  {
    icon: 'mail',
    title: 'Mail',
    body: 'The three messages in your inbox most worth answering, scored right here in your browser from sender, recipients and Gmail’s own preview. Hover any pick to see exactly why it was chosen.',
  },
  {
    icon: 'note',
    title: 'Notes',
    body: 'A plain scratchpad that saves as you type. No formatting to fight, no document to name.',
  },
  {
    icon: 'video',
    title: 'Music',
    body: 'Paste a YouTube link — a track, a playlist, a live radio stream — and it plays in place. Spotify is there too if you have Premium.',
  },
  {
    icon: 'link',
    title: 'Quick links',
    body: 'The handful of sites you actually open every day, kept in the nav bar where they are always one click away.',
  },
];

/** One entry in the FAQ. */
interface Question {
  /** The question, phrased the way someone would actually ask it. */
  q: string;
  /** A straight answer. */
  a: string;
}

const FAQ: Question[] = [
  {
    q: 'Do I need an account?',
    a: 'Not to try it — the demo is the real dashboard and needs nothing at all. An account only exists so that a layout and notes follow you to a second device.',
  },
  {
    q: 'Can I sign up?',
    a: 'No. This is a personal project rather than a service, and sign-in is restricted to a few accounts added by hand — an outside Google or email account will be turned away. Nothing is being sold, and the demo shows the whole application anyway.',
  },
  {
    q: 'Where is my data kept?',
    a: 'In your browser, in localStorage. If you sign in, that same data is mirrored to your account so another device can restore it. Nothing else is stored anywhere.',
  },
  {
    q: 'Is there a server?',
    a: 'No. This is a static site — the page you are reading is the whole application. Weather, headlines and calendar requests go from your browser straight to those services.',
  },
  {
    q: 'What does the Mail panel send to an AI?',
    a: 'Nothing. It used to ask a model which messages mattered; now it scores them locally with an explainable set of rules, so there is no API key and no third party involved.',
  },
  {
    q: 'Does it work on a phone?',
    a: 'Yes. The grid collapses to one column, panels can be reordered by touch, and the layout accounts for the safe areas around a notch and a home indicator.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. There is no paid tier, no trial, and no analytics or advertising to pay for it either.',
  },
];

/** Props for {@link LandingPage}. */
interface LandingPageProps {
  /** Opens the sample dashboard. */
  onTryDemo: () => void;
  /** Reveals the sign-in form. */
  onSignIn: () => void;
}

/**
 * What a signed-out visitor sees.
 *
 * Its job is to answer "what is this and why would I use it" without asking for
 * anything first, which is why the demo is given equal billing with sign-in —
 * the fastest honest answer to both questions is the dashboard itself, running.
 *
 * Only rendered when Clerk is configured (ADR 0003). With no key there is no
 * signed-out state to land on, and the dashboard opens directly, as it always
 * has.
 *
 * @param props - See {@link LandingPageProps}.
 */
export default function LandingPage({ onTryDemo, onSignIn }: LandingPageProps) {
  const [legal, setLegal] = useState<LegalDoc>(null);
  // The theme normally travels with the dashboard, which is not mounted here —
  // so without this a visitor who chose a dark palette gets a white landing page
  // on the way back in. Deliberately *not* called for the demo view: there the
  // dashboard's own settings own the palette, and two owners would fight.
  useTheme();

  return (
    <div className={styles.container}>
      <header className={styles.hero}>
        <p className={styles.mark}>
          <span>
            <Icon name="grid" />
          </span>
          Dashboard
        </p>

        <h1>Your whole day, on one page.</h1>
        <p className={styles.lede}>
          Everything you check first thing — what’s next, what you owe, the weather, the
          headlines, your inbox — in one place you arrange yourself. It runs entirely in
          your browser, there is no server, and it costs nothing.
        </p>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={onTryDemo}>
            <Icon name="play" />
            Try the live demo
          </button>
          <button className={styles.secondary} onClick={onSignIn}>
            Sign in
          </button>
        </div>
        <p className={styles.note}>
          The demo is the real dashboard with sample data. No account, no email, nothing to
          install — and nothing it does is saved to an account.
        </p>

        {/* Sits directly under the sign-in button on purpose. Someone who clicks
            it expecting to register would otherwise reach a form that cannot
            help them, and find that out only after typing their address in. */}
        <p className={styles.notice}>
          <Icon name="pin" />
          <span>
            <strong>This is a personal project, not a product.</strong> Sign-in only works
            for the handful of accounts I have added by hand — your own Google or email
            address will not get you in, and there is no way to sign up. The demo is the
            whole tour, and it needs none of that.
          </span>
        </p>
      </header>

      <section className={styles.lead} aria-labelledby="lead-heading">
        <p className={styles.eyebrow}>The Today zone</p>
        <h2 id="lead-heading">One answer to “what now?”</h2>
        <p>
          Most dashboards are a wall of boxes and leave the reading to you. This one leads
          with a single zone that merges your calendar events and your dated tasks into one
          timeline, then tells you the next thing and how long you have.
        </p>
        <ul className={styles.beats}>
          <li>
            <strong>Next up</strong>, with a live countdown that ticks on its own.
          </li>
          <li>
            <strong>Today’s agenda</strong>, calendar and tasks interleaved in time order
            rather than split across two panels.
          </li>
          <li>
            <strong>A running count</strong> of what is left, what is overdue, and what has
            no date yet — and nothing at all when the day is clear.
          </li>
          <li>
            <strong>One stated intention</strong> for the day, which expires at midnight so
            yesterday’s never lingers.
          </li>
        </ul>
      </section>

      <section aria-labelledby="panels-heading">
        <p className={styles.eyebrow}>The panels</p>
        <h2 id="panels-heading">Eight of them. Use the ones you want.</h2>
        <ul className={styles.grid}>
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <span className={styles.badge}>
                <Icon name={feature.icon} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="yours-heading">
        <p className={styles.eyebrow}>Make it yours</p>
        <h2 id="yours-heading">It is a layout, not a template.</h2>
        <ul className={styles.grid}>
          <li>
            <span className={styles.badge}>
              <Icon name="grip" />
            </span>
            <h3>Drag to reorder</h3>
            <p>
              Grab a panel’s handle and drop it where you want it. Arrow keys do the same
              thing, and every move is announced for screen readers.
            </p>
          </li>
          <li>
            <span className={styles.badge}>
              <Icon name="resize" />
            </span>
            <h3>Drag to resize</h3>
            <p>
              The corner handle sets width and height at once — width snaps to whole
              columns, height is free. Double-click it to go back to fitting the content.
            </p>
          </li>
          <li>
            <span className={styles.badge}>
              <Icon name="settings" />
            </span>
            <h3>Six themes</h3>
            <p>
              Light and dark, plus four more. Every panel, chart and control follows the
              palette — there are no hard-coded colours to clash with it.
            </p>
          </li>
          <li>
            <span className={styles.badge}>
              <Icon name="monitor" />
            </span>
            <h3>Add and remove</h3>
            <p>
              Turn panels off from the widget menu when you do not need them, and turn them
              back on later. Your arrangement is remembered.
            </p>
          </li>
        </ul>
      </section>

      <section className={styles.privacy} aria-labelledby="privacy-heading">
        <p className={styles.eyebrow}>Privacy</p>
        <h2 id="privacy-heading">No analytics, no ads, no tracking.</h2>
        <p>
          That is the whole policy, and it is worth being specific about what it means,
          because “private” is a word everyone uses.
        </p>
        <ul className={styles.beats}>
          <li>
            <strong>There is no server of ours.</strong> The site is static files. Your
            notes and tasks live in your browser’s storage and go nowhere unless you sign
            in.
          </li>
          <li>
            <strong>Signing in mirrors your dashboard to your account</strong> so a second
            device can restore it. That is the only copy that leaves, and it holds no
            credentials.
          </li>
          <li>
            <strong>Mail is read as metadata only.</strong> Gmail is asked for headers and
            its own short preview — message bodies are never fetched, so they cannot leak.
            Ranking happens on your machine.
          </li>
          <li>
            <strong>The services we contact are listed</strong> at the bottom of every page,
            and the Privacy Policy names each one and what it is for.
          </li>
        </ul>
      </section>

      <section aria-labelledby="faq-heading">
        <p className={styles.eyebrow}>Questions</p>
        <h2 id="faq-heading">The ones worth asking.</h2>
        <dl className={styles.faq}>
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <h2 id="closing-heading">Have a look around.</h2>
        <p>
          The demo opens the real thing, furnished with a sample day, and nothing you do in
          it is kept. Since sign-in is limited to accounts I have added by hand, the demo is
          not a preview of the product — it <em>is</em> the product, as far as anyone
          visiting can see it.
        </p>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onTryDemo}>
            <Icon name="play" />
            Try the live demo
          </button>
          <button className={styles.secondary} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </section>

      <Footer onOpenLegal={setLegal} />
      <LegalModal doc={legal} onClose={() => setLegal(null)} />
    </div>
  );
}

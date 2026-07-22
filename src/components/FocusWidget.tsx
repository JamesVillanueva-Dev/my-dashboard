import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

// A local rotating set of quotes — no external API, so it always works offline.
const QUOTES: [string, string][] = [
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['It always seems impossible until it’s done.', 'Nelson Mandela'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Simplicity is the soul of efficiency.', 'Austin Freeman'],
  ['What we think, we become.', 'Buddha'],
  ['Action is the foundational key to all success.', 'Pablo Picasso'],
  ['Do the hard jobs first. The easy jobs will take care of themselves.', 'Dale Carnegie'],
  ['Focus on being productive instead of busy.', 'Tim Ferriss'],
  ['You don’t have to be great to start, but you have to start to be great.', 'Zig Ziglar'],
  ['Little by little, one travels far.', 'J.R.R. Tolkien'],
  ['The best way out is always through.', 'Robert Frost'],
  ['Discipline is choosing between what you want now and what you want most.', 'Abraham Lincoln'],
];

/**
 * Computes the 1-based day-of-year for a date, used to pick a deterministic
 * "quote of the day" so everyone sees the same quote on a given date.
 *
 * @param d - The date to evaluate.
 * @returns Day of the year (1–366).
 */
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

/**
 * @returns Today's date as a stable `YYYY-MM-DD` key, used to reset the daily
 *   focus field when the calendar day changes.
 */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Focus of the Day" widget: a single editable intention field that resets each
 * calendar day, plus a deterministic daily quote drawn from a local list (no
 * network dependency). The focus text and its date persist in localStorage.
 */
export default function FocusWidget() {
  const [quote, author] = QUOTES[dayOfYear(new Date()) % QUOTES.length];
  const [focus, setFocus] = useLocalStorage<{ date: string; text: string }>('focus', {
    date: todayKey(),
    text: '',
  });

  // Reset the focus each new day.
  const text = focus.date === todayKey() ? focus.text : '';

  return (
    <Widget title="Focus of the Day">
      <label className="focus__label" htmlFor="focus-input">
        Today, my one focus is…
      </label>
      <input
        id="focus-input"
        className="focus__input"
        value={text}
        onChange={(e) => setFocus({ date: todayKey(), text: e.target.value })}
        placeholder="Set your intention"
      />
      <blockquote className="focus__quote">
        “{quote}”
        <cite>— {author}</cite>
      </blockquote>
    </Widget>
  );
}

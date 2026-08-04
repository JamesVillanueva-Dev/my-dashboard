import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import styles from './styles.module.css';

interface Link {
  id: string;
  label: string;
  url: string;
}

const DEFAULTS: Link[] = [
  { id: '1', label: 'Gmail', url: 'https://mail.google.com' },
  { id: '2', label: 'Calendar', url: 'https://calendar.google.com' },
  { id: '3', label: 'Drive', url: 'https://drive.google.com' },
  { id: '4', label: 'GitHub', url: 'https://github.com' },
  { id: '5', label: 'YouTube', url: 'https://youtube.com' },
];

/**
 * Ensures a user-entered URL has an explicit scheme so it links correctly.
 *
 * @param url - Raw URL, possibly missing the protocol (e.g. "example.com").
 * @returns The URL prefixed with "https://" when no http(s) scheme is present.
 */
function normalize(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Builds a Google S2 favicon URL for the host of the given link.
 *
 * @param url - The bookmark URL (with or without scheme).
 * @returns A 64px favicon image URL, or "" if the URL cannot be parsed.
 */
function favicon(url: string): string {
  try {
    const host = new URL(normalize(url)).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return '';
  }
}

/**
 * Bookmark shortcuts living in the nav bar, between the clock and the app
 * controls. Each link shows its site favicon and label and opens in a new tab;
 * the list is persisted to localStorage under `quicklinks`.
 *
 * These used to be a dashboard panel. Navigation is not something you scroll to
 * look up, so it belongs in the chrome that is always on screen rather than in
 * the grid — which also frees the row for panels you actually read.
 *
 * The bar itself stays read-only: adding and removing happen in a popover behind
 * the + button, so editing affordances never crowd the row. It closes on an
 * outside click or Escape, matching {@link WidgetMenu}.
 */
export default function QuickLinks() {
  const [links, setLinks] = useLocalStorage<Link[]>('quicklinks', DEFAULTS);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const add = () => {
    if (!label.trim() || !url.trim()) return;
    // A timestamp alone collides when two links are added in the same
    // millisecond, which duplicates React keys and makes one × remove both.
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLinks([...links, { id, label: label.trim(), url: normalize(url.trim()) }]);
    setLabel('');
    setUrl('');
  };
  const remove = (id: string) => setLinks(links.filter((l) => l.id !== id));

  return (
    <nav className={styles.container} aria-label="Quick links">
      <ul>
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.url} target="_blank" rel="noreferrer" title={l.label}>
              <img src={favicon(l.url)} alt="" width={18} height={18} />
              <span>{l.label}</span>
            </a>
          </li>
        ))}
      </ul>

      <div className={styles.manage} ref={ref}>
        <button
          className={styles.trigger}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Manage quick links"
          title="Manage quick links"
        >
          <Icon name="plus" />
        </button>
        {open && (
          <div role="menu">
            <p>Add a link</p>
            <div className={styles.form}>
              <input
                type="text"
                placeholder="Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                type="text"
                placeholder="example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
              />
              <button className={styles.add} onClick={add}>
                Save
              </button>
            </div>

            {links.length > 0 && (
              <>
                <p>Your links</p>
                <ul>
                  {links.map((l) => (
                    <li key={l.id}>
                      <img src={favicon(l.url)} alt="" width={16} height={16} />
                      <span>{l.label}</span>
                      <button
                        onClick={() => remove(l.id)}
                        title="Remove"
                        aria-label={`Remove ${l.label}`}
                      >
                        <Icon name="close" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

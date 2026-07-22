import { useState } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

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
 * Editable grid of bookmark shortcuts persisted to localStorage. Each link shows
 * its site favicon and label, opens in a new tab, and can be removed on hover.
 * New links can be added inline; URLs missing a scheme are normalised to https.
 */
export default function QuickLinksWidget() {
  const [links, setLinks] = useLocalStorage<Link[]>('quicklinks', DEFAULTS);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  const add = () => {
    if (!label.trim() || !url.trim()) return;
    setLinks([...links, { id: `${Date.now()}`, label: label.trim(), url: normalize(url.trim()) }]);
    setLabel('');
    setUrl('');
    setAdding(false);
  };
  const remove = (id: string) => setLinks(links.filter((l) => l.id !== id));

  return (
    <Widget
      title="Quick Links"
      action={
        <button className="pill" onClick={() => setAdding((a) => !a)} title="Add link">
          {adding ? '×' : '+'}
        </button>
      }
    >
      {adding && (
        <div className="reminder__form">
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
          <button className="btn" onClick={add}>
            Save
          </button>
        </div>
      )}
      <div className="links__grid">
        {links.map((l) => (
          <div key={l.id} className="links__item">
            <a href={l.url} target="_blank" rel="noreferrer">
              <img src={favicon(l.url)} alt="" width={28} height={28} />
              <span>{l.label}</span>
            </a>
            <button className="links__del" onClick={() => remove(l.id)} title="Remove">
              ×
            </button>
          </div>
        ))}
      </div>
    </Widget>
  );
}

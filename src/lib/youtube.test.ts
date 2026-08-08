import { describe, it, expect, vi } from 'vitest';
import { playlistTitle, thumbnailUrl } from './youtube';

const PLAYLIST_ID = 'PLRBp0Fe2Gpgms';

/** The oEmbed request `playlistTitle` is expected to make for {@link PLAYLIST_ID}. */
const OEMBED_URL =
  'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPLRBp0Fe2Gpgms';

/** Stubs the oEmbed endpoint with one response. */
function stubOembed(response: { ok: boolean; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: response.ok, json: () => Promise.resolve(response.body) })),
  );
}

describe('playlistTitle', () => {
  it('requests the oEmbed description of the playlist page', async () => {
    stubOembed({ ok: true, body: { title: 'NCS : The Best Of House' } });

    await playlistTitle(PLAYLIST_ID);

    expect(fetch).toHaveBeenCalledWith(OEMBED_URL);
  });

  it('returns the title oEmbed reports', async () => {
    stubOembed({ ok: true, body: { title: 'NCS : The Best Of House' } });

    expect(await playlistTitle(PLAYLIST_ID)).toBe('NCS : The Best Of House');
  });

  it('trims surrounding whitespace from the title', async () => {
    stubOembed({ ok: true, body: { title: '  Focus  ' } });

    // A padded name would otherwise become a padded tab.
    expect(await playlistTitle(PLAYLIST_ID)).toBe('Focus');
  });

  it('returns null when oEmbed refuses to describe the playlist', async () => {
    // What an unlisted or deleted playlist answers.
    stubOembed({ ok: false });

    expect(await playlistTitle(PLAYLIST_ID)).toBeNull();
  });

  it('returns null when the request itself fails', async () => {
    // The suite's default fetch rejects, which is the offline browser.
    expect(await playlistTitle(PLAYLIST_ID)).toBeNull();
  });

  it('returns null when the title is blank', async () => {
    stubOembed({ ok: true, body: { title: '   ' } });

    expect(await playlistTitle(PLAYLIST_ID)).toBeNull();
  });
});

describe('thumbnailUrl', () => {
  it('builds a thumbnail URL on the cookieless image host', () => {
    expect(thumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });
});

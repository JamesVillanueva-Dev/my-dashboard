import { describe, it, expect, vi } from 'vitest';
import { playlistTitle, thumbnailUrl } from './youtube';

/** Stubs the oEmbed endpoint with one response. */
function stubOembed(response: { ok: boolean; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: response.ok, json: () => Promise.resolve(response.body) }),
    ),
  );
}

describe('playlistTitle', () => {
  it('asks oEmbed about the playlist page and returns its title', async () => {
    stubOembed({ ok: true, body: { title: 'NCS : The Best Of House' } });

    expect(await playlistTitle('PLRBp0Fe2Gpgms')).toBe('NCS : The Best Of House');
    expect(fetch).toHaveBeenCalledWith(
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPLRBp0Fe2Gpgms',
    );
  });

  it('trims the title, so a padded name does not become a padded tab', async () => {
    stubOembed({ ok: true, body: { title: '  Focus  ' } });

    expect(await playlistTitle('PLRBp0Fe2Gpgms')).toBe('Focus');
  });

  it('gives up quietly on a playlist YouTube will not describe', async () => {
    // What an unlisted or deleted playlist answers.
    stubOembed({ ok: false });

    expect(await playlistTitle('PLRBp0Fe2Gpgms')).toBeNull();
  });

  it('gives up quietly when the request itself fails', async () => {
    // The suite's default fetch rejects, which is the offline browser.
    expect(await playlistTitle('PLRBp0Fe2Gpgms')).toBeNull();
  });

  it('treats a response without a usable title as no answer', async () => {
    stubOembed({ ok: true, body: { title: '   ' } });

    expect(await playlistTitle('PLRBp0Fe2Gpgms')).toBeNull();
  });
});

describe('thumbnailUrl', () => {
  it('points at the cookieless image host', () => {
    expect(thumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import YouTubeWidget from './index';
import styles from './styles.module.css';

/**
 * The tail every embed carries: the IFrame API opt-in that lets the queue below
 * the player read the list — and lets playback be handed to the embed that
 * replaces this one when the panel opens full screen — locked to this page's
 * origin.
 */
const JSAPI = `enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;

const EMBED_HOST = 'https://www.youtube-nocookie.com/embed';

/** The playlist the widget ships with. */
const DEFAULT_LIST_ID = 'PLRBp0Fe2GpgmsW46rJyudVFlY6IYjFBIK';

/** Names the queue's thumbnail buttons, which are labelled by position. */
const TRACKS = /^Play track \d+$/;

/** Opens the add form, pastes `link`, and saves it under an optional `name`. */
async function addSource(user: ReturnType<typeof userEvent.setup>, link: string, name?: string) {
  await user.click(screen.getByTitle('Add a video or playlist'));
  if (name) await user.type(screen.getByPlaceholderText('Name (optional)'), name);
  await user.type(screen.getByPlaceholderText('Paste a YouTube link…'), link);
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

/** The embed iframe for a named source. */
const embedFor = (name: string) => screen.getByTitle(`YouTube – ${name}`);

/** Seeds the saved source list and the one being shown. */
function seedSources(sources: unknown[], currentId: string) {
  window.localStorage.setItem('youtube.sources', JSON.stringify(sources));
  window.localStorage.setItem('youtube.current', JSON.stringify(currentId));
}

/**
 * Stands in for YouTube's IFrame Player API, which is a network script talking
 * to a cross-origin frame — neither of which exists in jsdom. Reports `items` as
 * the loaded playlist and answers `onReady` a tick later, as the real API does.
 */
function stubPlayerApi(items: string[] | null, index = 0) {
  const player = {
    getPlaylist: () => items,
    getPlaylistIndex: () => (items ? index : -1),
    getVideoData: () => ({
      video_id: items?.[index] ?? 'dQw4w9WgXcQ',
      title: `Track ${index + 1}`,
    }),
    playVideoAt: vi.fn(),
    getCurrentTime: () => 0,
    getPlayerState: () => 1,
    seekTo: vi.fn(),
    playVideo: vi.fn(),
  };
  vi.stubGlobal(
    'YT',
    {
      Player: function (
        _frame: HTMLIFrameElement,
        options: { events: { onReady(event: { target: typeof player }): void } },
      ) {
        setTimeout(() => options.events.onReady({ target: player }), 0);
        return player;
      },
    },
    // The API script is only loaded when it is missing, so a stubbed global is
    // enough to keep the hook off the network.
  );
  return player;
}

// `restoreMocks` covers spies, not globals — without this the stubbed player
// API would still be installed for the tests that expect no queue at all.
afterEach(() => vi.unstubAllGlobals());

describe('YouTubeWidget on first load', () => {
  it('plays the default source in the embed iframe', () => {
    render(<YouTubeWidget />);

    expect(embedFor('NoCopyrightSounds')).toHaveAttribute(
      'src',
      `${EMBED_HOST}/videoseries?rel=0&list=${DEFAULT_LIST_ID}&${JSAPI}`,
    );
  });

  it('retires the dead livestream a dashboard may have already persisted', async () => {
    // What every dashboard that opened the panel before the default changed has
    // sitting in storage. The stream is offline, so this embed renders "This live
    // stream recording is not available" rather than a player.
    seedSources([{ id: '1', label: 'lofi hip hop radio', videoId: 'jfKfPfyJRdk', listId: null }], '1');

    render(<YouTubeWidget />);

    expect(embedFor('NoCopyrightSounds')).toHaveAttribute(
      'src',
      expect.stringContaining(`list=${DEFAULT_LIST_ID}`),
    );
    // Healed in storage too, not just on screen.
    await waitFor(() =>
      expect(localStorage.getItem('youtube.sources')).not.toContain('jfKfPfyJRdk'),
    );
  });

  it('leaves a source the user added themselves alone', () => {
    seedSources(
      [
        { id: '1', label: 'NoCopyrightSounds', videoId: null, listId: 'PLRBp0Fe2Gpgms' },
        { id: '1770000000000', label: 'My Mix', videoId: 'dQw4w9WgXcQ', listId: null },
      ],
      '1',
    );

    render(<YouTubeWidget />);

    expect(screen.getByRole('button', { name: 'My Mix' })).toBeInTheDocument();
    expect(localStorage.getItem('youtube.sources')).toContain('dQw4w9WgXcQ');
  });
});

describe('YouTubeWidget reading a pasted link', () => {
  it('rejects a non-YouTube link with an error message', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://example.com/watch?v=dQw4w9WgXcQ');

    expect(screen.getByText(/doesn.t look like a YouTube link/i)).toBeInTheDocument();
  });

  it('adds a video from a watch URL and switches the player to it', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'My Song');

    expect(embedFor('My Song')).toHaveAttribute(
      'src',
      `${EMBED_HOST}/dQw4w9WgXcQ?rel=0&${JSAPI}`,
    );
    expect(localStorage.getItem('youtube.sources')).toContain('dQw4w9WgXcQ');
  });

  it('accepts a short youtu.be link', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://youtu.be/dQw4w9WgXcQ?si=abc');

    expect(embedFor('Video')).toHaveAttribute('src', expect.stringContaining('/embed/dQw4w9WgXcQ'));
  });

  it('accepts a bare video id', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'dQw4w9WgXcQ');

    expect(embedFor('Video')).toHaveAttribute('src', expect.stringContaining('/embed/dQw4w9WgXcQ'));
  });

  it('loads a playlist page as a playlist rather than a single video', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(
      user,
      'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );

    expect(embedFor('Playlist')).toHaveAttribute(
      'src',
      `${EMBED_HOST}/videoseries?rel=0&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&${JSAPI}`,
    );
  });

  it('keeps both ids when a link names a video inside a playlist', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(
      user,
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );

    // A video that arrived inside a playlist is one: it plays on into the list,
    // and the panel labels and treats it that way.
    expect(embedFor('Playlist')).toHaveAttribute(
      'src',
      `${EMBED_HOST}/dQw4w9WgXcQ?rel=0&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&${JSAPI}`,
    );
  });

  it('keeps the video and drops the un-embeddable Watch Later list beside it', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=WL&index=1');

    // list=WL would render "This video is unavailable"; the video alone plays.
    expect(embedFor('Video')).toHaveAttribute('src', `${EMBED_HOST}/dQw4w9WgXcQ?rel=0&${JSAPI}`);
  });

  it('explains why a Watch Later playlist on its own cannot be added', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://www.youtube.com/playlist?list=WL');

    expect(screen.getByText(/private to your account/i)).toBeInTheDocument();
  });

  it('accepts an auto-generated mix, which does embed and play', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(
      user,
      'https://www.youtube.com/watch?v=3MqrxfiXTwg&list=RD3MqrxfiXTwg&start_radio=1',
    );

    // Labelled "Mix" rather than "Playlist": YouTube generates these per viewer,
    // so there is no playlist page and no name to go and look up.
    expect(embedFor('Mix')).toHaveAttribute(
      'src',
      `${EMBED_HOST}/3MqrxfiXTwg?rel=0&list=RD3MqrxfiXTwg&${JSAPI}`,
    );
  });
});

describe('YouTubeWidget naming sources', () => {
  it('names a pasted playlist after itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ title: 'The Best Of House' }) }),
      ),
    );
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(
      user,
      'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );

    // Saved as "Playlist", then renamed once YouTube answers.
    expect(await screen.findByRole('button', { name: 'The Best Of House' })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('youtube.sources')).toContain('Best Of House'));
  });

  it('keeps a name the user typed rather than looking one up', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://www.youtube.com/playlist?list=PLFgquLnL59a', 'Focus');

    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks which sources are playlists in the tab row', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://youtu.be/dQw4w9WgXcQ', 'My Song');

    // The glyph is decorative — the tab already says what it is — so it is only
    // findable as markup.
    const playlistTab = screen.getByRole('button', { name: 'NoCopyrightSounds' });
    const videoTab = screen.getByRole('button', { name: 'My Song' });
    expect(playlistTab.querySelector('svg')).not.toBeNull();
    expect(videoTab.querySelector('svg')).toBeNull();
  });
});

describe('YouTubeWidget switching and keeping sources', () => {
  it('switches back to a saved source via its tab', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);
    await addSource(user, 'https://youtu.be/dQw4w9WgXcQ');
    expect(screen.queryByTitle('YouTube – NoCopyrightSounds')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'NoCopyrightSounds' }));

    expect(embedFor('NoCopyrightSounds')).toBeInTheDocument();
  });

  it('still has an added source after the dashboard is closed and reopened', async () => {
    const user = userEvent.setup();
    const firstVisit = render(<YouTubeWidget />);
    await addSource(user, 'https://www.youtube.com/watch?v=3MqrxfiXTwg', 'My Song');
    expect(embedFor('My Song')).toBeInTheDocument();

    // Unmount and mount a fresh instance: the same thing a page reload does, since
    // the widget's only memory between sessions is localStorage.
    firstVisit.unmount();
    render(<YouTubeWidget />);

    expect(screen.getByRole('button', { name: 'My Song' })).toBeInTheDocument();
    expect(embedFor('My Song')).toHaveAttribute(
      'src',
      expect.stringContaining('/embed/3MqrxfiXTwg'),
    );
  });

  it('removes a source', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await user.click(screen.getByRole('button', { name: 'Remove NoCopyrightSounds' }));

    expect(screen.queryByTitle('YouTube – NoCopyrightSounds')).not.toBeInTheDocument();
    expect(screen.getByText(/No music yet/i)).toBeInTheDocument();
  });
});

describe('YouTubeWidget playlist queue', () => {
  it('draws one thumbnail per track', async () => {
    stubPlayerApi(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'], 1);
    render(<YouTubeWidget />);

    const tracks = await screen.findAllByRole('button', { name: TRACKS });

    expect(tracks).toHaveLength(3);
    expect(tracks[0].querySelector('img')).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg',
    );
  });

  it('marks the track that is playing', async () => {
    stubPlayerApi(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'], 1);
    render(<YouTubeWidget />);

    const tracks = await screen.findAllByRole('button', { name: TRACKS });

    expect(tracks[1]).toHaveClass(styles.isActive);
    expect(tracks[1]).toHaveAttribute('aria-current', 'true');
    expect(tracks[0]).not.toHaveAttribute('aria-current');
  });

  it('says where playback is, and what it is on', async () => {
    stubPlayerApi(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'], 1);
    render(<YouTubeWidget />);

    await screen.findAllByRole('button', { name: TRACKS });

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('Track 2')).toBeInTheDocument();
  });

  it('jumps the player to a track picked out of the queue', async () => {
    const player = stubPlayerApi(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    const tracks = await screen.findAllByRole('button', { name: TRACKS });
    await user.click(tracks[2]);

    expect(player.playVideoAt).toHaveBeenCalledWith(2);
  });

  it('leaves a single video without a queue', async () => {
    // What the real player answers for a lone video: it is attached, and asked,
    // and says there is no playlist. The embed opts into the API either way now,
    // so this is what keeps the strip off — not the absence of a player.
    stubPlayerApi(null);
    seedSources([{ id: '9', label: 'My Song', videoId: 'dQw4w9WgXcQ', listId: null }], '9');

    render(<YouTubeWidget />);

    expect(embedFor('My Song')).toHaveAttribute('src', `${EMBED_HOST}/dQw4w9WgXcQ?rel=0&${JSAPI}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('button', { name: TRACKS })).not.toBeInTheDocument();
  });
});

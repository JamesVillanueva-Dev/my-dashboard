import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useYouTubePlaylist } from './useYouTubePlaylist';

/** `YT.PlayerState`: playing, and paused. */
const PLAYING = 1;
const PAUSED = 2;

/** Long enough for at least one position sample to be taken. */
const SAMPLE_INTERVAL_MS = 600;

/**
 * One stubbed player: the state a test sets, the API the hook reads it through,
 * and the two events a test fires by hand.
 */
interface FakePlayer {
  /* ---------- What the test sets ---------- */
  playlist: string[] | null;
  index: number;
  time: number;
  state: number;

  /* ---------- What the hook calls ---------- */
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
  getVideoData(): { video_id: string; title: string };
  getCurrentTime(): number;
  getPlayerState(): number;
  playVideoAt: ReturnType<typeof vi.fn>;
  seekTo: ReturnType<typeof vi.fn>;
  playVideo: ReturnType<typeof vi.fn>;

  /* ---------- What the test fires ---------- */
  /** Announces that this player has loaded, as the real API does. */
  ready(): void;
  /** Announces a transition — a track ending, or the next one starting. */
  change(): void;
}

/**
 * Stands in for YouTube's IFrame Player API.
 *
 * Returns the list every `new YT.Player(...)` appends to, so a test can drive
 * each embed separately — which is the whole subject here: what the *second*
 * player does with what the first one saw.
 */
function stubPlayerApi(): FakePlayer[] {
  const players: FakePlayer[] = [];
  vi.stubGlobal('YT', {
    Player: function (
      _frame: HTMLIFrameElement,
      options: {
        events: {
          onReady(event: { target: FakePlayer }): void;
          onStateChange(event: { target: FakePlayer }): void;
        };
      },
    ) {
      const player: FakePlayer = {
        playlist: null,
        index: -1,
        time: 0,
        state: PLAYING,
        playVideoAt: vi.fn(),
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        getPlaylist: () => player.playlist,
        getPlaylistIndex: () => player.index,
        getVideoData: () => ({
          video_id: player.playlist?.[player.index] ?? 'solo',
          title: 'A track',
        }),
        getCurrentTime: () => player.time,
        getPlayerState: () => player.state,
        ready: () => options.events.onReady({ target: player }),
        change: () => options.events.onStateChange({ target: player }),
      };
      players.push(player);
      return player;
    },
  });
  return players;
}

/** A fresh embed element. */
const anEmbed = () => document.createElement('iframe');

/** Mounts the hook on `frame`, and lets the (already resolved) API attach. */
async function attachTo(frame: HTMLIFrameElement) {
  const view = renderHook(({ embed }) => useYouTubePlaylist(embed), {
    initialProps: { embed: frame },
  });
  await act(async () => {});
  return view;
}

/** Swaps in a different embed, as opening or closing the full-screen view does. */
async function swapEmbed(view: Awaited<ReturnType<typeof attachTo>>, frame: HTMLIFrameElement) {
  view.rerender({ embed: frame });
  await act(async () => {});
}

/** Lets the hook sample the playing position at least once. */
async function letPositionBeSampled() {
  await act(async () => vi.advanceTimersByTime(SAMPLE_INTERVAL_MS));
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useYouTubePlaylist', () => {
  it('reports the playlist the embed has loaded', async () => {
    const players = stubPlayerApi();
    const view = await attachTo(anEmbed());

    players[0].playlist = ['aaa', 'bbb', 'ccc'];
    players[0].index = 1;
    act(() => players[0].ready());

    expect(view.result.current.items).toEqual(['aaa', 'bbb', 'ccc']);
    expect(view.result.current.index).toBe(1);
    expect(view.result.current.title).toBe('A track');
  });
});

describe('useYouTubePlaylist when the embed is rebuilt', () => {
  it('hands a standalone video its position back, still playing', async () => {
    const players = stubPlayerApi();
    const view = await attachTo(anEmbed());
    players[0].time = 42.5;
    act(() => players[0].ready());
    // The position is sampled as it plays; this is the last one before the
    // embed goes away.
    await letPositionBeSampled();

    await swapEmbed(view, anEmbed());
    act(() => players[1].ready());

    expect(players[1].seekTo).toHaveBeenCalledWith(42.5, true);
    expect(players[1].playVideo).toHaveBeenCalled();
  });

  it('returns a playlist to the track it was on', async () => {
    const players = stubPlayerApi();
    const view = await attachTo(anEmbed());
    players[0].playlist = ['aaa', 'bbb', 'ccc'];
    players[0].index = 2;
    players[0].time = 88;
    act(() => players[0].ready());
    await letPositionBeSampled();

    // A reloaded embed starts the playlist over, at the first track.
    await swapEmbed(view, anEmbed());
    players[1].playlist = ['aaa', 'bbb', 'ccc'];
    players[1].index = 0;
    act(() => players[1].ready());

    expect(players[1].playVideoAt).toHaveBeenCalledWith(2);
  });

  it('waits for that track before seeking into it', async () => {
    const players = stubPlayerApi();
    const view = await attachTo(anEmbed());
    players[0].playlist = ['aaa', 'bbb', 'ccc'];
    players[0].index = 2;
    players[0].time = 88;
    act(() => players[0].ready());
    await letPositionBeSampled();
    await swapEmbed(view, anEmbed());
    players[1].playlist = ['aaa', 'bbb', 'ccc'];
    players[1].index = 0;

    act(() => players[1].ready());

    // Seeking now would land in whichever track is still loaded.
    expect(players[1].seekTo).not.toHaveBeenCalled();

    players[1].index = 2;
    act(() => players[1].change());

    expect(players[1].seekTo).toHaveBeenCalledWith(88, true);
  });

  it('leaves a player that was paused paused, at the offset it was paused at', async () => {
    const players = stubPlayerApi();
    const view = await attachTo(anEmbed());
    players[0].time = 12;
    players[0].state = PAUSED;
    act(() => players[0].ready());
    await letPositionBeSampled();

    await swapEmbed(view, anEmbed());
    act(() => players[1].ready());

    expect(players[1].seekTo).toHaveBeenCalledWith(12, true);
    expect(players[1].playVideo).not.toHaveBeenCalled();
  });

  it('does not push one source’s position onto another the user switched to', async () => {
    const players = stubPlayerApi();
    const view = await attachTo(anEmbed());
    players[0].playlist = ['aaa', 'bbb'];
    players[0].index = 0;
    players[0].time = 30;
    act(() => players[0].ready());
    await letPositionBeSampled();

    // A different playlist entirely: nothing it holds was ever playing.
    await swapEmbed(view, anEmbed());
    players[1].playlist = ['xxx', 'yyy'];
    players[1].index = 0;
    act(() => players[1].ready());

    expect(players[1].seekTo).not.toHaveBeenCalled();
    expect(players[1].playVideoAt).not.toHaveBeenCalled();
  });

  it('spends a resume once, so a later embed does not re-seek to a stale offset', async () => {
    const players = stubPlayerApi();
    const view = await attachTo(anEmbed());
    players[0].time = 20;
    act(() => players[0].ready());
    await letPositionBeSampled();
    await swapEmbed(view, anEmbed());
    act(() => players[1].ready());
    expect(players[1].seekTo).toHaveBeenCalledWith(20, true);

    // A third embed with nothing sampled in between inherits nothing.
    await swapEmbed(view, anEmbed());
    act(() => players[2].ready());

    expect(players[2].seekTo).not.toHaveBeenCalled();
  });
});

describe('useYouTubePlaylist when the API never loads', () => {
  it('reports an empty playlist', async () => {
    vi.stubGlobal('YT', undefined);

    const view = await attachTo(anEmbed());

    expect(view.result.current.items).toEqual([]);
    expect(view.result.current.index).toBe(-1);
  });

  it('leaves playAt inert rather than throwing', async () => {
    vi.stubGlobal('YT', undefined);

    const view = await attachTo(anEmbed());

    // The embed underneath is untouched.
    expect(() => view.result.current.playAt(2)).not.toThrow();
  });
});

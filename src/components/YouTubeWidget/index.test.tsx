import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import YouTubeWidget from './index';

/** Opens the add form, pastes `link`, and saves it under an optional `name`. */
async function addSource(user: ReturnType<typeof userEvent.setup>, link: string, name?: string) {
  await user.click(screen.getByTitle('Add a video or playlist'));
  if (name) await user.type(screen.getByPlaceholderText('Name (optional)'), name);
  await user.type(screen.getByPlaceholderText('Paste a YouTube link…'), link);
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

describe('YouTubeWidget', () => {
  it('plays the default source in the embed iframe', () => {
    render(<YouTubeWidget />);
    const frame = screen.getByTitle('YouTube – NoCopyrightSounds');
    expect(frame).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/videoseries?rel=0&list=PLRBp0Fe2GpgmsW46rJyudVFlY6IYjFBIK',
    );
  });

  it('retires the dead livestream a dashboard may have already persisted', async () => {
    // What every dashboard that opened the panel before the default changed has
    // sitting in storage. The stream is offline, so this embed renders "This live
    // stream recording is not available" rather than a player.
    window.localStorage.setItem(
      'youtube.sources',
      JSON.stringify([
        { id: '1', label: 'lofi hip hop radio', videoId: 'jfKfPfyJRdk', listId: null },
      ]),
    );
    window.localStorage.setItem('youtube.current', JSON.stringify('1'));

    render(<YouTubeWidget />);

    const frame = screen.getByTitle('YouTube – NoCopyrightSounds');
    expect(frame).toHaveAttribute(
      'src',
      expect.stringContaining('list=PLRBp0Fe2GpgmsW46rJyudVFlY6IYjFBIK'),
    );
    // Healed in storage too, not just on screen.
    await waitFor(() =>
      expect(localStorage.getItem('youtube.sources')).not.toContain('jfKfPfyJRdk'),
    );
  });

  it('leaves a source the user added themselves alone', async () => {
    window.localStorage.setItem(
      'youtube.sources',
      JSON.stringify([
        { id: '1', label: 'NoCopyrightSounds', videoId: null, listId: 'PLRBp0Fe2Gpgms' },
        { id: '1770000000000', label: 'My Mix', videoId: 'dQw4w9WgXcQ', listId: null },
      ]),
    );

    render(<YouTubeWidget />);

    expect(screen.getByRole('button', { name: 'My Mix' })).toBeInTheDocument();
    expect(localStorage.getItem('youtube.sources')).toContain('dQw4w9WgXcQ');
  });

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

    expect(screen.getByTitle('YouTube – My Song')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
    );
    expect(localStorage.getItem('youtube.sources')).toContain('dQw4w9WgXcQ');
  });

  it('accepts a short youtu.be link', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://youtu.be/dQw4w9WgXcQ?si=abc');

    expect(screen.getByTitle('YouTube – Video')).toHaveAttribute(
      'src',
      expect.stringContaining('/embed/dQw4w9WgXcQ'),
    );
  });

  it('loads a playlist page as a playlist rather than a single video', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');

    expect(screen.getByTitle('YouTube – Playlist')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/videoseries?rel=0&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );
  });

  it('keeps both ids when a link names a video inside a playlist', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(
      user,
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );

    expect(screen.getByTitle('YouTube – Video')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );
  });

  it('keeps the video and drops the un-embeddable Watch Later list beside it', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=WL&index=1');

    // list=WL would render "This video is unavailable"; the video alone plays.
    expect(screen.getByTitle('YouTube – Video')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
    );
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

    await addSource(user, 'https://www.youtube.com/watch?v=3MqrxfiXTwg&list=RD3MqrxfiXTwg&start_radio=1');

    expect(screen.getByTitle('YouTube – Video')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/3MqrxfiXTwg?rel=0&list=RD3MqrxfiXTwg',
    );
  });

  it('accepts a bare video id', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'dQw4w9WgXcQ');

    expect(screen.getByTitle('YouTube – Video')).toHaveAttribute(
      'src',
      expect.stringContaining('/embed/dQw4w9WgXcQ'),
    );
  });

  it('switches back to a saved source via its tab', async () => {
    const user = userEvent.setup();
    render(<YouTubeWidget />);

    await addSource(user, 'https://youtu.be/dQw4w9WgXcQ');
    expect(screen.queryByTitle('YouTube – NoCopyrightSounds')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'NoCopyrightSounds' }));
    expect(screen.getByTitle('YouTube – NoCopyrightSounds')).toBeInTheDocument();
  });

  it('still has an added source after the dashboard is closed and reopened', async () => {
    const user = userEvent.setup();
    const first = render(<YouTubeWidget />);

    await addSource(user, 'https://www.youtube.com/watch?v=3MqrxfiXTwg', 'My Song');
    expect(screen.getByTitle('YouTube – My Song')).toBeInTheDocument();

    // Unmount and mount a fresh instance: the same thing a page reload does, since
    // the widget's only memory between sessions is localStorage.
    first.unmount();
    render(<YouTubeWidget />);

    expect(screen.getByRole('button', { name: 'My Song' })).toBeInTheDocument();
    expect(screen.getByTitle('YouTube – My Song')).toHaveAttribute(
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

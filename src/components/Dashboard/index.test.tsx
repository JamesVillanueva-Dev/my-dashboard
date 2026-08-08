import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './index';
import { DEFAULT_LAYOUT } from '../../lib/registry';

/** The reorder grips, one per panel on the grid. */
const dragGrips = () => screen.getAllByRole('button', { name: /^reorder /i });

/** The resize handle of the Weather panel, which most sizing cases use. */
const weatherResizeHandle = () => screen.getByRole('button', { name: /^resize weather/i });

/** The heading of one widget card. */
const widgetHeading = (name: string) => screen.queryByRole('heading', { level: 2, name });

/** Opens the widget menu and returns it. */
async function openWidgetMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /manage widgets/i }));
  return screen.getByRole('menu');
}

/** The grid item wrapping a grip — the element a drag transforms. */
const itemOf = (grip: HTMLElement) => grip.closest<HTMLElement>('[data-id]')!;

/**
 * A pointer event jsdom can actually construct — it implements no
 * `PointerEvent`, so this is a `MouseEvent` wearing the two fields the drag
 * reads off it.
 */
function pointerEvent(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.assign(event, { pointerId: init.pointerId ?? 1, pointerType: 'mouse' });
  return event;
}

/** Presses the pointer on `grip` and moves it `dx` px, as a mouse would. */
function grab(grip: HTMLElement, dx = 0) {
  grip.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0 }));
  if (dx) window.dispatchEvent(pointerEvent('pointermove', { clientX: dx, clientY: 0 }));
}

describe('Dashboard layout on first load', () => {
  it('renders every default widget', () => {
    render(<Dashboard />);

    for (const title of ['Tasks', 'Calendar', 'Weather', 'News', 'Notes', 'YouTube']) {
      expect(widgetHeading(title)).toBeInTheDocument();
    }
  });

  it('leaves the opt-in Spotify panel off', () => {
    render(<Dashboard />);

    expect(widgetHeading('Spotify')).not.toBeInTheDocument();
  });

  it('leads with the Today zone, above the widget grid', () => {
    render(<Dashboard />);

    expect(screen.getByRole('heading', { level: 2, name: 'Next up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a focus' })).toBeInTheDocument();
  });

  it('drops retired widget ids from a saved layout instead of crashing', () => {
    // 'todo', 'focus' and 'quicklinks' shipped as panels and no longer are one.
    window.localStorage.setItem(
      'layout',
      JSON.stringify(['todo', 'notes', 'focus', 'weather', 'quicklinks']),
    );

    render(<Dashboard />);

    expect(widgetHeading('Notes')).toBeInTheDocument();
    expect(widgetHeading('Weather')).toBeInTheDocument();
    expect(widgetHeading('To-do')).not.toBeInTheDocument();
    expect(widgetHeading('Quick Links')).not.toBeInTheDocument();
  });

  it('surfaces a widget’s network failure as an error, not a crash', async () => {
    render(<Dashboard />);

    // fetch is stubbed to reject in test setup.
    expect(await screen.findByText(/Couldn't load weather/i)).toBeInTheDocument();
  });
});

describe('Dashboard widget menu', () => {
  it('switches an opt-in widget on', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const menu = await openWidgetMenu(user);
    await user.click(within(menu).getByRole('checkbox', { name: 'Spotify' }));

    expect(widgetHeading('Spotify')).toBeInTheDocument();
  });

  it('switches a widget off', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const menu = await openWidgetMenu(user);
    await user.click(within(menu).getByLabelText(/Notes/));

    expect(widgetHeading('Notes')).not.toBeInTheDocument();
  });

  it('switches it back on again', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const menu = await openWidgetMenu(user);
    await user.click(within(menu).getByLabelText(/Notes/));

    await user.click(within(menu).getByLabelText(/Notes/));

    expect(widgetHeading('Notes')).toBeInTheDocument();
  });

  it('turns the daily focus off', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(screen.getByRole('button', { name: 'Set a focus' })).toBeInTheDocument();

    const menu = await openWidgetMenu(user);
    await user.click(within(menu).getByLabelText(/daily focus/i));

    expect(screen.queryByRole('button', { name: 'Set a focus' })).not.toBeInTheDocument();
    expect(localStorage.getItem('today.showFocus')).toBe('false');
  });

  it('turns the daily focus back on', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const menu = await openWidgetMenu(user);
    await user.click(within(menu).getByLabelText(/daily focus/i));

    await user.click(within(menu).getByLabelText(/daily focus/i));

    expect(screen.getByRole('button', { name: 'Set a focus' })).toBeInTheDocument();
  });
});

describe('Dashboard reordering', () => {
  it('gives each widget a reorder handle', () => {
    render(<Dashboard />);

    expect(dragGrips()).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it('does not lift a panel until the pointer has actually travelled', () => {
    render(<Dashboard />);
    const grip = dragGrips()[0];

    // A plain click, and a twitch smaller than the threshold.
    grab(grip, 2);

    expect(itemOf(grip).style.transform).toBe('');
    window.dispatchEvent(pointerEvent('pointerup'));
  });

  it('leaves nothing stuck when a drag is cancelled mid-gesture', () => {
    // A system gesture or a lost pointer fires `pointercancel` instead of
    // `pointerup`. With only one exit path, that used to strand the panel
    // mid-air with its listeners still attached.
    render(<Dashboard />);
    const grip = dragGrips()[0];
    const item = itemOf(grip);

    grab(grip, 40);
    window.dispatchEvent(pointerEvent('pointercancel'));

    expect(item.style.transform).toBe('');
    expect(item.style.pointerEvents).toBe('');
  });

  it('ends the gesture, so further movement does nothing', () => {
    render(<Dashboard />);
    const grip = dragGrips()[0];
    const item = itemOf(grip);
    grab(grip, 40);
    window.dispatchEvent(pointerEvent('pointercancel'));

    window.dispatchEvent(pointerEvent('pointermove', { clientX: 300, clientY: 0 }));

    expect(item.style.transform).toBe('');
  });

  it('reorders a widget with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const headingsBefore = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);

    dragGrips()[0].focus();
    await user.keyboard('{ArrowDown}');

    const headingsAfter = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headingsAfter).not.toEqual(headingsBefore);
  });

  it('announces the move', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    dragGrips()[0].focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByText(/moved to position 2 of/i)).toBeInTheDocument();
  });

  it('removes a widget via its × button', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(widgetHeading('Notes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove notes widget/i }));

    expect(widgetHeading('Notes')).not.toBeInTheDocument();
  });
});

describe('Dashboard resizing', () => {
  it('widens a panel with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    // Weather ships one column wide.
    expect(weatherResizeHandle()).toHaveAccessibleName(/1 column wide/i);

    weatherResizeHandle().focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');

    expect(weatherResizeHandle()).toHaveAccessibleName(/3 columns wide/i);
  });

  it('persists the new width', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    weatherResizeHandle().focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');

    expect(JSON.parse(localStorage.getItem('widget.sizes')!)).toMatchObject({
      weather: { cols: 3, height: null },
    });
  });

  it('announces the new width', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    weatherResizeHandle().focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');

    expect(screen.getByText(/weather resized to 3 columns wide/i)).toBeInTheDocument();
  });

  it('will not narrow a panel past a single column', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    weatherResizeHandle().focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');

    expect(weatherResizeHandle()).toHaveAccessibleName(/1 column wide/i);
  });

  it('pins a height with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(weatherResizeHandle()).toHaveAccessibleName(/height fits the content/i);

    weatherResizeHandle().focus();
    await user.keyboard('{ArrowDown}');

    // jsdom lays nothing out, so the panel measures 0 tall and the first press
    // lands on the floor rather than one step above it.
    expect(weatherResizeHandle()).toHaveAccessibleName(/120 pixels tall/i);
  });

  it('fits a pinned height back to the content on Enter', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    weatherResizeHandle().focus();
    await user.keyboard('{ArrowDown}');

    // Enter unpins, the keyboard equivalent of double-clicking the handle.
    await user.keyboard('{Enter}');

    expect(weatherResizeHandle()).toHaveAccessibleName(/height fits the content/i);
  });

  it('reads back the named widths saved before panels were freely resizable', () => {
    localStorage.setItem('widget.sizes', JSON.stringify({ weather: 'wide' }));

    render(<Dashboard />);

    expect(weatherResizeHandle()).toHaveAccessibleName(/3 columns wide/i);
  });

  it('restores default sizes on reset', async () => {
    localStorage.setItem('widget.sizes', JSON.stringify({ weather: { cols: 4, height: 400 } }));
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(weatherResizeHandle()).toHaveAccessibleName(/4 columns wide, 400 pixels tall/i);

    await openWidgetMenu(user);
    await user.click(screen.getByRole('button', { name: /reset layout and sizes/i }));

    expect(weatherResizeHandle()).toHaveAccessibleName(/1 column wide, height fits the content/i);
  });
});

describe('Dashboard footer', () => {
  it('opens the Privacy Policy', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    await user.click(screen.getByRole('button', { name: 'Privacy Policy' }));

    const dialog = screen.getByRole('dialog', { name: 'Privacy Policy' });
    expect(within(dialog).getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
  });

  it('closes it again', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole('button', { name: 'Privacy Policy' }));

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }),
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the Terms of Service', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    await user.click(screen.getByRole('button', { name: 'Terms of Service' }));

    expect(screen.getByRole('dialog', { name: 'Terms of Service' })).toBeInTheDocument();
  });
});

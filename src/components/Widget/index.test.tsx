import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Widget from './index';
import { WidgetChromeProvider, type WidgetChrome } from './chrome';
import styles from './styles.module.css';

/** Chrome as the dashboard grid supplies it, overridable per test. */
function chrome(over: Partial<WidgetChrome> = {}): WidgetChrome {
  return {
    id: 'weather',
    size: { cols: 2, height: null },
    onResizeStart: vi.fn(),
    onResizeKeyDown: vi.fn(),
    onFitHeight: vi.fn(),
    onRemove: vi.fn(),
    onGrab: vi.fn(),
    onGripKeyDown: vi.fn(),
    isDragging: false,
    isResizing: false,
    ...over,
  };
}

/** Renders a widget inside the grid, as the dashboard does. */
function renderInGrid(over: Partial<WidgetChrome> = {}) {
  const value = chrome(over);
  const utils = render(
    <WidgetChromeProvider value={value}>
      <Widget title="Weather" icon="cloudSun">
        <p>18°C</p>
      </Widget>
    </WidgetChromeProvider>,
  );
  return { ...utils, chrome: value };
}

describe('Widget', () => {
  it('renders its title and body', () => {
    render(<Widget title="Weather">18°C</Widget>);

    expect(screen.getByRole('heading', { name: 'Weather' })).toBeInTheDocument();
    expect(screen.getByText('18°C')).toBeInTheDocument();
  });

  it('renders an icon beside the title when given one', () => {
    const { container } = render(<Widget title="Weather" icon="cloudSun">body</Widget>);

    expect(container.querySelector('h2 svg')).toBeInTheDocument();
  });

  it('omits the icon when none is given', () => {
    const { container } = render(<Widget title="Weather">body</Widget>);

    expect(container.querySelector('h2 svg')).toBeNull();
  });

  it('renders the action slot in the header', () => {
    render(
      <Widget title="Weather" action={<button>Refresh</button>}>
        body
      </Widget>,
    );

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it("puts the calling widget's own root class on the card", () => {
    const { container } = render(
      <Widget title="Weather" className="weather-root">
        body
      </Widget>,
    );

    const card = container.querySelector('section')!;
    expect(card).toHaveClass(styles.container);
    expect(card).toHaveClass('weather-root');
  });

  describe('outside the dashboard grid', () => {
    it('renders no management controls', () => {
      render(<Widget title="Weather">body</Widget>);

      expect(screen.queryByRole('button', { name: /^Reorder/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Resize/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    });

    it('still renders the title, body, and action', () => {
      render(
        <Widget title="Weather" action={<span>now</span>}>
          18°C
        </Widget>,
      );

      expect(screen.getByRole('heading', { name: 'Weather' })).toBeInTheDocument();
      expect(screen.getByText('18°C')).toBeInTheDocument();
      expect(screen.getByText('now')).toBeInTheDocument();
    });
  });

  describe('inside the dashboard grid', () => {
    it('renders the drag handle, resize, and remove controls', () => {
      renderInGrid();

      expect(
        screen.getByRole('button', { name: 'Reorder Weather. Use the arrow keys to move it.' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Resize Weather/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove Weather widget' })).toBeInTheDocument();
    });

    it('starts a resize drag from the corner handle, passing the widget id', () => {
      const { chrome } = renderInGrid();

      fireEvent.pointerDown(screen.getByRole('button', { name: /^Resize/ }));

      expect(chrome.onResizeStart).toHaveBeenCalledWith(expect.anything(), 'weather');
    });

    it('forwards arrow keys from the handle, so resizing works without a pointer', () => {
      const { chrome } = renderInGrid();

      fireEvent.keyDown(screen.getByRole('button', { name: /^Resize/ }), { key: 'ArrowRight' });

      expect(chrome.onResizeKeyDown).toHaveBeenCalledWith(expect.anything(), 'weather');
    });

    it('fits the height to the content when the handle is double-clicked', () => {
      const { chrome } = renderInGrid({ size: { cols: 2, height: 300 } });

      fireEvent.doubleClick(screen.getByRole('button', { name: /^Resize/ }));

      expect(chrome.onFitHeight).toHaveBeenCalledWith('weather');
    });

    it('states both dimensions on the handle, so its size is readable without sight', () => {
      renderInGrid({ size: { cols: 1, height: 300 } });
      expect(screen.getByRole('button', { name: /^Resize/ })).toHaveAccessibleName(
        /1 column wide, 300 pixels tall/,
      );

      const auto = renderInGrid({ size: { cols: 3, height: null } });
      expect(
        within(auto.container).getByRole('button', { name: /^Resize/ }),
      ).toHaveAccessibleName(/3 columns wide, height fits the content/);
    });

    it('keeps the resize handle reachable by keyboard', () => {
      renderInGrid();

      expect(screen.getByRole('button', { name: /^Resize/ })).toHaveAttribute('tabindex', '0');
    });

    it('lets its body scroll only once the height is pinned', () => {
      const { container } = renderInGrid({ size: { cols: 2, height: 300 } });
      expect(container.querySelector('section')).toHaveClass(styles.isPinned);

      const auto = renderInGrid();
      expect(auto.container.querySelector('section')).not.toHaveClass(styles.isPinned);
    });

    it('marks itself as being resized only while it is the panel under the pointer', () => {
      const { container } = renderInGrid({ isResizing: true });
      expect(container.querySelector('section')).toHaveClass(styles.isResizing);

      const still = renderInGrid();
      expect(still.container.querySelector('section')).not.toHaveClass(styles.isResizing);
    });

    it('removes the widget when remove is clicked', () => {
      const { chrome } = renderInGrid();

      fireEvent.click(screen.getByRole('button', { name: 'Remove Weather widget' }));

      expect(chrome.onRemove).toHaveBeenCalledTimes(1);
    });

    it('starts a drag from the handle, passing the widget id', () => {
      const { chrome } = renderInGrid();

      fireEvent.pointerDown(screen.getByRole('button', { name: /^Reorder/ }));

      expect(chrome.onGrab).toHaveBeenCalledWith(expect.anything(), 'weather');
    });

    it('forwards arrow keys from the handle, so reordering works without a pointer', () => {
      const { chrome } = renderInGrid();

      fireEvent.keyDown(screen.getByRole('button', { name: /^Reorder/ }), { key: 'ArrowDown' });

      expect(chrome.onGripKeyDown).toHaveBeenCalledWith(expect.anything(), 'weather');
    });

    it('keeps the handle reachable by keyboard', () => {
      renderInGrid();

      expect(screen.getByRole('button', { name: /^Reorder/ })).toHaveAttribute('tabindex', '0');
    });

    it('marks itself compact at one column wide, for the tighter type scale', () => {
      const { container } = renderInGrid({ size: { cols: 1, height: null } });

      expect(container.querySelector('section')).toHaveClass(styles.isCompact);
    });

    it('is not compact once it has been widened', () => {
      const { container } = renderInGrid({ size: { cols: 3, height: null } });

      expect(container.querySelector('section')).not.toHaveClass(styles.isCompact);
    });

    it('marks itself as lifted only while it is the panel being dragged', () => {
      const { container } = renderInGrid({ isDragging: true });
      expect(container.querySelector('section')).toHaveClass(styles.isDragging);

      const still = renderInGrid({ isDragging: false });
      expect(still.container.querySelector('section')).not.toHaveClass(styles.isDragging);
    });
  });
});

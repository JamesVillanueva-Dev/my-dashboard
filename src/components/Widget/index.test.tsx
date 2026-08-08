import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Widget from './index';
import { WidgetChromeProvider, type WidgetChrome } from './chrome';
import styles from './styles.module.css';

/** Chrome as the dashboard grid supplies it, overridable per test. */
function chrome(overrides: Partial<WidgetChrome> = {}): WidgetChrome {
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
    ...overrides,
  };
}

/** Renders a widget inside the grid, as the dashboard does. */
function renderInGrid(
  chromeOverrides: Partial<WidgetChrome> = {},
  props: { expandable?: boolean } = {},
) {
  const value = chrome(chromeOverrides);
  const view = render(
    <WidgetChromeProvider value={value}>
      <Widget title="Weather" icon="cloudSun" {...props}>
        <p>18°C</p>
      </Widget>
    </WidgetChromeProvider>,
  );
  return { ...view, chrome: value, card: () => view.container.querySelector('section')! };
}

const resizeHandle = () => screen.getByRole('button', { name: /^Resize/ });
const dragHandle = () => screen.getByRole('button', { name: /^Reorder/ });

describe('Widget card', () => {
  it('renders its title and body', () => {
    render(<Widget title="Weather">18°C</Widget>);

    expect(screen.getByRole('heading', { name: 'Weather' })).toBeInTheDocument();
    expect(screen.getByText('18°C')).toBeInTheDocument();
  });

  it('renders an icon beside the title when given one', () => {
    const { container } = render(
      <Widget title="Weather" icon="cloudSun">
        body
      </Widget>,
    );

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
});

describe('Widget full screen', () => {
  it('offers no expand button unless the widget asks for one', () => {
    render(<Widget title="Weather">18°C</Widget>);

    expect(screen.queryByRole('button', { name: /full screen/ })).not.toBeInTheDocument();
  });

  it('reopens the body in a dialog', () => {
    render(
      <Widget title="Notes" expandable>
        <p>my note</p>
      </Widget>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show Notes full screen' }));

    expect(within(screen.getByRole('dialog')).getByText('my note')).toBeInTheDocument();
  });

  it('hands the body back to the card on close', () => {
    render(
      <Widget title="Notes" expandable>
        <p>my note</p>
      </Widget>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show Notes full screen' }));

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close Notes' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('my note')).toBeInTheDocument();
  });

  it('draws the body in one place at a time, so nothing is mounted twice', () => {
    render(
      <Widget title="Notes" expandable>
        <p>my note</p>
      </Widget>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show Notes full screen' }));

    // Would throw on a second copy behind the dialog.
    expect(screen.getByText('my note')).toBeInTheDocument();
  });

  it('leaves the card its slot in the grid', () => {
    const { card } = renderInGrid({}, { expandable: true });

    fireEvent.click(screen.getByRole('button', { name: 'Show Weather full screen' }));

    expect(card()).toBeInTheDocument();
  });

  it('offers a way back to the card', () => {
    renderInGrid({}, { expandable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Show Weather full screen' }));

    fireEvent.click(screen.getByRole('button', { name: 'Bring it back' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Widget outside the dashboard grid', () => {
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

describe('Widget inside the dashboard grid', () => {
  it('renders the drag handle, resize, and remove controls', () => {
    renderInGrid();

    expect(
      screen.getByRole('button', { name: 'Reorder Weather. Use the arrow keys to move it.' }),
    ).toBeInTheDocument();
    expect(resizeHandle()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Weather widget' })).toBeInTheDocument();
  });

  it('removes the widget when remove is clicked', () => {
    const { chrome } = renderInGrid();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Weather widget' }));

    expect(chrome.onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('Widget resize handle', () => {
  it('starts a resize drag from the corner, passing the widget id', () => {
    const { chrome } = renderInGrid();

    fireEvent.pointerDown(resizeHandle());

    expect(chrome.onResizeStart).toHaveBeenCalledWith(expect.anything(), 'weather');
  });

  it('forwards arrow keys, so resizing works without a pointer', () => {
    const { chrome } = renderInGrid();

    fireEvent.keyDown(resizeHandle(), { key: 'ArrowRight' });

    expect(chrome.onResizeKeyDown).toHaveBeenCalledWith(expect.anything(), 'weather');
  });

  it('fits the height to the content when double-clicked', () => {
    const { chrome } = renderInGrid({ size: { cols: 2, height: 300 } });

    fireEvent.doubleClick(resizeHandle());

    expect(chrome.onFitHeight).toHaveBeenCalledWith('weather');
  });

  it('states a pinned height on the handle, so the size is readable without sight', () => {
    renderInGrid({ size: { cols: 1, height: 300 } });

    expect(resizeHandle()).toHaveAccessibleName(/1 column wide, 300 pixels tall/);
  });

  it('says so on the handle when the height fits the content', () => {
    renderInGrid({ size: { cols: 3, height: null } });

    expect(resizeHandle()).toHaveAccessibleName(/3 columns wide, height fits the content/);
  });

  it('is reachable by keyboard', () => {
    renderInGrid();

    expect(resizeHandle()).toHaveAttribute('tabindex', '0');
  });
});

describe('Widget drag handle', () => {
  it('starts a drag, passing the widget id', () => {
    const { chrome } = renderInGrid();

    fireEvent.pointerDown(dragHandle());

    expect(chrome.onGrab).toHaveBeenCalledWith(expect.anything(), 'weather');
  });

  it('forwards arrow keys, so reordering works without a pointer', () => {
    const { chrome } = renderInGrid();

    fireEvent.keyDown(dragHandle(), { key: 'ArrowDown' });

    expect(chrome.onGripKeyDown).toHaveBeenCalledWith(expect.anything(), 'weather');
  });

  it('is reachable by keyboard', () => {
    renderInGrid();

    expect(dragHandle()).toHaveAttribute('tabindex', '0');
  });
});

describe('Widget state classes', () => {
  it('lets its body scroll once the height is pinned', () => {
    const { card } = renderInGrid({ size: { cols: 2, height: 300 } });

    expect(card()).toHaveClass(styles.isPinned);
  });

  it('does not pin a panel whose height fits its content', () => {
    const { card } = renderInGrid();

    expect(card()).not.toHaveClass(styles.isPinned);
  });

  it('marks itself as being resized while it is the panel under the pointer', () => {
    const { card } = renderInGrid({ isResizing: true });

    expect(card()).toHaveClass(styles.isResizing);
  });

  it('is not marked as being resized otherwise', () => {
    const { card } = renderInGrid();

    expect(card()).not.toHaveClass(styles.isResizing);
  });

  it('marks itself compact at one column wide, for the tighter type scale', () => {
    const { card } = renderInGrid({ size: { cols: 1, height: null } });

    expect(card()).toHaveClass(styles.isCompact);
  });

  it('is not compact once it has been widened', () => {
    const { card } = renderInGrid({ size: { cols: 3, height: null } });

    expect(card()).not.toHaveClass(styles.isCompact);
  });

  it('marks itself as lifted while it is the panel being dragged', () => {
    const { card } = renderInGrid({ isDragging: true });

    expect(card()).toHaveClass(styles.isDragging);
  });

  it('is not marked as lifted otherwise', () => {
    const { card } = renderInGrid({ isDragging: false });

    expect(card()).not.toHaveClass(styles.isDragging);
  });
});

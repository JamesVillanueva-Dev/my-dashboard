import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useDismiss } from './useDismiss';

/** What the hook's `open` argument means at the call site. */
const OPEN = true;
const CLOSED = false;

/**
 * A popover shaped like the real call sites: the ref wraps *both* the trigger and
 * the panel, so clicking the trigger to close never counts as an outside click.
 */
function Popover({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const ref = useDismiss<HTMLDivElement>(open, onDismiss);
  return (
    <>
      <div ref={ref}>
        <button>Menu</button>
        {open && <button>Sign out</button>}
      </div>
      <p>Elsewhere</p>
    </>
  );
}

/** Renders the popover, returning the dismiss spy alongside RTL's helpers. */
function renderPopover(open = OPEN) {
  const onDismiss = vi.fn();
  const view = render(<Popover open={open} onDismiss={onDismiss} />);
  const rerenderPopover = (nextOpen: boolean, nextOnDismiss: () => void = onDismiss) =>
    view.rerender(<Popover open={nextOpen} onDismiss={nextOnDismiss} />);
  return { ...view, rerenderPopover, onDismiss };
}

/** Clicks somewhere outside the popover. */
const clickOutside = () => fireEvent.mouseDown(screen.getByText('Elsewhere'));

/** Presses a key on the document, where the hook listens. */
const pressKey = (key: string) => fireEvent.keyDown(document, { key });

describe('useDismiss', () => {
  it('hands back a ref that starts empty', () => {
    const { result } = renderHook(() => useDismiss(CLOSED, vi.fn()));

    expect(result.current.current).toBeNull();
  });
});

describe('useDismiss while open', () => {
  it('dismisses on a click outside', () => {
    const { onDismiss } = renderPopover();

    clickOutside();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves a click inside the popover alone', () => {
    const { onDismiss } = renderPopover();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Sign out' }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('counts the trigger as inside, so clicking it to close does not race', () => {
    const { onDismiss } = renderPopover();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Menu' }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on Escape', () => {
    const { onDismiss } = renderPopover();

    pressKey('Escape');

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores every other key', () => {
    const { onDismiss } = renderPopover();

    pressKey('ArrowDown');
    pressKey('Enter');
    pressKey('Esc');

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does nothing when the ref was never attached to anything', () => {
    const onDismiss = vi.fn();
    renderHook(() => useDismiss(OPEN, onDismiss));

    fireEvent.mouseDown(document.body);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('useDismiss while closed', () => {
  it('binds no listeners at all', () => {
    const addListener = vi.spyOn(document, 'addEventListener');

    renderPopover(CLOSED);

    expect(addListener).not.toHaveBeenCalledWith('mousedown', expect.anything());
    expect(addListener).not.toHaveBeenCalledWith('keydown', expect.anything());
  });

  it('ignores clicks and Escape', () => {
    const { onDismiss } = renderPopover(CLOSED);

    clickOutside();
    pressKey('Escape');

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('useDismiss tearing down', () => {
  it('stops listening once the popover closes', () => {
    const { rerenderPopover, onDismiss } = renderPopover();

    rerenderPopover(CLOSED);
    clickOutside();
    pressKey('Escape');

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    const { unmount, onDismiss } = renderPopover();

    unmount();
    fireEvent.mouseDown(document.body);
    pressKey('Escape');

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('useDismiss and the callback it was given', () => {
  it('calls the latest one, not the one captured when it opened', () => {
    const { rerenderPopover, onDismiss } = renderPopover();
    const replacement = vi.fn();

    rerenderPopover(OPEN, replacement);
    clickOutside();

    expect(replacement).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not rebind the listeners when it changes identity', () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const { rerenderPopover } = renderPopover();
    const mousedownBindings = () =>
      addListener.mock.calls.filter(([type]) => type === 'mousedown').length;
    expect(mousedownBindings()).toBe(1);

    // A fresh arrow function every render is the norm at the call sites.
    rerenderPopover(OPEN, vi.fn());
    rerenderPopover(OPEN, vi.fn());

    expect(mousedownBindings()).toBe(1);
  });
});

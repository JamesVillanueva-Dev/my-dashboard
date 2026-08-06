import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useDismiss } from './useDismiss';

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
function setup(open = true) {
  const onDismiss = vi.fn();
  const utils = render(<Popover open={open} onDismiss={onDismiss} />);
  const rerender = (next: boolean, cb: () => void = onDismiss) =>
    utils.rerender(<Popover open={next} onDismiss={cb} />);
  return { ...utils, rerender, onDismiss };
}

describe('useDismiss', () => {
  it('hands back a ref that starts empty', () => {
    const { result } = renderHook(() => useDismiss(false, vi.fn()));

    expect(result.current.current).toBeNull();
  });

  describe('while open', () => {
    it('dismisses on a click outside', () => {
      const { onDismiss } = setup();

      fireEvent.mouseDown(screen.getByText('Elsewhere'));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('leaves a click inside the popover alone', () => {
      const { onDismiss } = setup();

      fireEvent.mouseDown(screen.getByRole('button', { name: 'Sign out' }));

      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('counts the trigger as inside, so clicking it to close does not race', () => {
      const { onDismiss } = setup();

      fireEvent.mouseDown(screen.getByRole('button', { name: 'Menu' }));

      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('dismisses on Escape', () => {
      const { onDismiss } = setup();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('ignores every other key', () => {
      const { onDismiss } = setup();

      fireEvent.keyDown(document, { key: 'ArrowDown' });
      fireEvent.keyDown(document, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'Esc' });

      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('does nothing when the ref was never attached to anything', () => {
      const onDismiss = vi.fn();
      renderHook(() => useDismiss(true, onDismiss));

      fireEvent.mouseDown(document.body);

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('while closed', () => {
    it('costs nothing — no listeners are bound', () => {
      const add = vi.spyOn(document, 'addEventListener');

      setup(false);

      expect(add).not.toHaveBeenCalledWith('mousedown', expect.anything());
      expect(add).not.toHaveBeenCalledWith('keydown', expect.anything());
    });

    it('ignores clicks and Escape', () => {
      const { onDismiss } = setup(false);

      fireEvent.mouseDown(screen.getByText('Elsewhere'));
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('tearing down', () => {
    it('stops listening once the popover closes', () => {
      const { rerender, onDismiss } = setup();

      rerender(false);
      fireEvent.mouseDown(screen.getByText('Elsewhere'));
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('stops listening once unmounted', () => {
      const { unmount, onDismiss } = setup();

      unmount();
      fireEvent.mouseDown(document.body);
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('the callback', () => {
    it('uses the latest one, not the one captured when it opened', () => {
      const { rerender, onDismiss } = setup();
      const replacement = vi.fn();

      rerender(true, replacement);
      fireEvent.mouseDown(screen.getByText('Elsewhere'));

      expect(replacement).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('does not rebind the listeners when it changes identity', () => {
      const add = vi.spyOn(document, 'addEventListener');
      const { rerender } = setup();
      expect(add.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1);

      // A fresh arrow function every render is the norm at the call sites.
      rerender(true, vi.fn());
      rerender(true, vi.fn());

      expect(add.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1);
    });
  });
});

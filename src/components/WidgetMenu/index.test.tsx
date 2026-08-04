import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WidgetMenu from './index';
import { WIDGETS } from '../../lib/registry';

/** Renders the menu with sensible defaults, returning the spies. */
function setup(over: Partial<Parameters<typeof WidgetMenu>[0]> = {}) {
  const props = {
    layout: WIDGETS.map((w) => w.id),
    onToggle: vi.fn(),
    onReset: vi.fn(),
    showFocus: true,
    onToggleFocus: vi.fn(),
    ...over,
  };
  return { ...render(<WidgetMenu {...props} />), props };
}

/** Opens the dropdown. */
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Manage widgets' }));
}

describe('WidgetMenu', () => {
  it('starts closed', () => {
    setup();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage widgets' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens on click and reports it to assistive technology', () => {
    setup();

    open();

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage widgets' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('closes again on a second click', () => {
    setup();

    open();
    open();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists every widget in the catalogue', () => {
    setup();

    open();

    for (const w of WIDGETS) {
      expect(screen.getByRole('checkbox', { name: new RegExp(w.title) })).toBeInTheDocument();
    }
  });

  it('ticks the widgets that are in the layout and clears the rest', () => {
    setup({ layout: ['notes'] });

    open();

    expect(screen.getByRole('checkbox', { name: /Notes/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Weather/ })).not.toBeChecked();
  });

  it('toggles a widget by id', () => {
    const { props } = setup({ layout: ['notes'] });

    open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Weather/ }));

    expect(props.onToggle).toHaveBeenCalledWith('weather');
  });

  it('toggles the daily focus field independently of the widgets', () => {
    const { props } = setup({ showFocus: false });

    open();
    const focus = screen.getByRole('checkbox', { name: /Daily focus/ });
    expect(focus).not.toBeChecked();

    fireEvent.click(focus);

    expect(props.onToggleFocus).toHaveBeenCalledTimes(1);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('resets the layout', () => {
    const { props } = setup();

    open();
    fireEvent.click(screen.getByRole('button', { name: /Reset layout and sizes/ }));

    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('points at the per-panel resize control rather than offering sizes here', () => {
    setup();

    open();

    expect(screen.getByText(/Drag a panel's bottom-right corner/)).toBeInTheDocument();
  });

  describe('dismissal', () => {
    it('closes on Escape', () => {
      setup();
      open();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes on a click outside', () => {
      setup();
      open();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('stays open when the click lands inside the menu', () => {
      setup();
      open();

      fireEvent.mouseDown(screen.getByRole('menu'));

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('ignores other keys', () => {
      setup();
      open();

      fireEvent.keyDown(document, { key: 'a' });

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('stops listening once closed, so it does not leak handlers', () => {
      const remove = vi.spyOn(document, 'removeEventListener');
      setup();

      open();
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });
});

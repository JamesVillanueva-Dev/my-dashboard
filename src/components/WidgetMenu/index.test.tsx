import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WidgetMenu from './index';
import { WIDGETS } from '../../lib/registry';

/** Renders the menu with sensible defaults, returning the spies. */
function renderWidgetMenu(overrides: Partial<Parameters<typeof WidgetMenu>[0]> = {}) {
  const props = {
    layout: WIDGETS.map((widget) => widget.id),
    onToggle: vi.fn(),
    onReset: vi.fn(),
    showFocus: true,
    onToggleFocus: vi.fn(),
    ...overrides,
  };
  return { ...render(<WidgetMenu {...props} />), props };
}

/** Clicks the trigger, which opens the dropdown — or closes an open one. */
const clickTrigger = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Manage widgets' }));

const trigger = () => screen.getByRole('button', { name: 'Manage widgets' });

describe('WidgetMenu opening and closing', () => {
  it('starts closed', () => {
    renderWidgetMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on click and reports it to assistive technology', () => {
    renderWidgetMenu();

    clickTrigger();

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes again on a second click', () => {
    renderWidgetMenu();

    clickTrigger();
    clickTrigger();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('WidgetMenu contents', () => {
  it('lists every widget in the catalogue', () => {
    renderWidgetMenu();

    clickTrigger();

    for (const widget of WIDGETS) {
      expect(screen.getByRole('checkbox', { name: new RegExp(widget.title) })).toBeInTheDocument();
    }
  });

  it('ticks the widgets that are in the layout and clears the rest', () => {
    renderWidgetMenu({ layout: ['notes'] });

    clickTrigger();

    expect(screen.getByRole('checkbox', { name: /Notes/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Weather/ })).not.toBeChecked();
  });

  it('points at the per-panel resize control rather than offering sizes here', () => {
    renderWidgetMenu();

    clickTrigger();

    expect(screen.getByText(/Drag a panel's bottom-right corner/)).toBeInTheDocument();
  });
});

describe('WidgetMenu actions', () => {
  it('toggles a widget by id', () => {
    const { props } = renderWidgetMenu({ layout: ['notes'] });

    clickTrigger();
    fireEvent.click(screen.getByRole('checkbox', { name: /Weather/ }));

    expect(props.onToggle).toHaveBeenCalledWith('weather');
  });

  it('toggles the daily focus field independently of the widgets', () => {
    const { props } = renderWidgetMenu({ showFocus: false });

    clickTrigger();
    const focusToggle = screen.getByRole('checkbox', { name: /Daily focus/ });
    expect(focusToggle).not.toBeChecked();
    fireEvent.click(focusToggle);

    expect(props.onToggleFocus).toHaveBeenCalledTimes(1);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('resets the layout', () => {
    const { props } = renderWidgetMenu();

    clickTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Reset layout and sizes/ }));

    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});

describe('WidgetMenu dismissal', () => {
  it('closes on Escape', () => {
    renderWidgetMenu();
    clickTrigger();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on a click outside', () => {
    renderWidgetMenu();
    clickTrigger();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('stays open when the click lands inside the menu', () => {
    renderWidgetMenu();
    clickTrigger();

    fireEvent.mouseDown(screen.getByRole('menu'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('ignores other keys', () => {
    renderWidgetMenu();
    clickTrigger();

    fireEvent.keyDown(document, { key: 'a' });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('stops listening once closed, so it does not leak handlers', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    renderWidgetMenu();

    clickTrigger();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(removeListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

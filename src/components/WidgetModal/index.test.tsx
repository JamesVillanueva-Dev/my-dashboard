import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import WidgetModal from './index';

/** Renders the dialog with a close spy, returning both. */
function open(over: { className?: string } = {}) {
  const onClose = vi.fn();
  const utils = render(
    <WidgetModal title="News" icon="newspaper" onClose={onClose} {...over}>
      <a href="#one">First</a>
      <a href="#two">Last</a>
    </WidgetModal>,
  );
  return { ...utils, onClose };
}

describe('WidgetModal', () => {
  it('renders the widget body inside a labelled modal dialog', () => {
    open();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('News');
    expect(within(dialog).getByText('First')).toBeInTheDocument();
  });

  it('renders into the document body, clear of the transformed widget card', () => {
    const { container } = open();

    // Nothing lands in the caller's tree; the portal takes it all to the body.
    expect(container).toBeEmptyDOMElement();
    expect(document.body).toContainElement(screen.getByRole('dialog'));
  });

  it("carries the widget's own root class, so its styles still apply", () => {
    open({ className: 'news-root' });

    expect(screen.getByRole('dialog')).toHaveClass('news-root');
  });

  it('marks itself expanded, the hook a widget uses to fill the extra room', () => {
    open();

    expect(screen.getByRole('dialog')).toHaveAttribute('data-expanded');
  });

  it("keeps the widget's own header controls in reach", () => {
    const onClose = vi.fn();
    render(
      <WidgetModal title="News" action={<button>Refresh</button>} onClose={onClose}>
        body
      </WidgetModal>,
    );

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('closes on the close button, the backdrop, and Escape', () => {
    const first = open();
    fireEvent.click(screen.getByRole('button', { name: 'Close News' }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = open();
    // The backdrop is the dialog's parent; the dialog itself must not close it.
    fireEvent.click(screen.getByRole('dialog'));
    expect(second.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(second.onClose).toHaveBeenCalledTimes(1);
    second.unmount();

    const third = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(third.onClose).toHaveBeenCalledTimes(1);
  });

  it('locks the page behind it, and gives the scroll back on close', () => {
    const { unmount } = open();
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('takes focus on open and returns it to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = open();
    expect(screen.getByRole('dialog')).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps Tab inside the dialog', () => {
    open();
    const dialog = screen.getByRole('dialog');
    // The close button leads (it is in the header); the body's links follow.
    const close = within(dialog).getByRole('button', { name: 'Close News' });
    const last = within(dialog).getByRole('link', { name: 'Last' });

    // Forwards off the last control wraps to the first.
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();

    // Backwards off the first wraps to the last.
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

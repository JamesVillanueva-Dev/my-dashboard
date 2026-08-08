import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import WidgetModal from './index';

/** Renders the dialog with a close spy, returning both. */
function openModal(props: { className?: string } = {}) {
  const onClose = vi.fn();
  const view = render(
    <WidgetModal title="News" icon="newspaper" onClose={onClose} {...props}>
      <a href="#one">First</a>
      <a href="#two">Last</a>
    </WidgetModal>,
  );
  return { ...view, onClose };
}

const modal = () => screen.getByRole('dialog');

/** The backdrop is the dialog's parent. */
const backdrop = () => modal().parentElement!;

describe('WidgetModal', () => {
  it('renders the widget body inside a labelled modal dialog', () => {
    openModal();

    expect(modal()).toHaveAttribute('aria-modal', 'true');
    expect(modal()).toHaveAccessibleName('News');
    expect(within(modal()).getByText('First')).toBeInTheDocument();
  });

  it('renders into the document body, clear of the transformed widget card', () => {
    const { container } = openModal();

    // Nothing lands in the caller's tree; the portal takes it all to the body.
    expect(container).toBeEmptyDOMElement();
    expect(document.body).toContainElement(modal());
  });

  it("carries the widget's own root class, so its styles still apply", () => {
    openModal({ className: 'news-root' });

    expect(modal()).toHaveClass('news-root');
  });

  it('marks itself expanded, the hook a widget uses to fill the extra room', () => {
    openModal();

    expect(modal()).toHaveAttribute('data-expanded');
  });

  it("keeps the widget's own header controls in reach", () => {
    render(
      <WidgetModal title="News" action={<button>Refresh</button>} onClose={vi.fn()}>
        body
      </WidgetModal>,
    );

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});

describe('WidgetModal dismissal', () => {
  it('closes on the close button', () => {
    const { onClose } = openModal();

    fireEvent.click(screen.getByRole('button', { name: 'Close News' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click on the backdrop', () => {
    const { onClose } = openModal();

    fireEvent.click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when the click lands on the dialog itself', () => {
    const { onClose } = openModal();

    fireEvent.click(modal());

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onClose } = openModal();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('WidgetModal and the page behind it', () => {
  it('locks the page scroll while open', () => {
    openModal();

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('gives the scroll back on close', () => {
    const { unmount } = openModal();

    unmount();

    expect(document.body.style.overflow).toBe('');
  });

  it('takes focus on open', () => {
    openModal();

    expect(modal()).toHaveFocus();
  });

  it('returns focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = openModal();

    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe('WidgetModal focus trap', () => {
  it('wraps Tab off the last control round to the first', () => {
    openModal();
    // The close button leads (it is in the header); the body's links follow.
    const closeButton = within(modal()).getByRole('button', { name: 'Close News' });
    within(modal()).getByRole('link', { name: 'Last' }).focus();

    fireEvent.keyDown(modal(), { key: 'Tab' });

    expect(closeButton).toHaveFocus();
  });

  it('wraps Shift+Tab off the first control round to the last', () => {
    openModal();
    const lastLink = within(modal()).getByRole('link', { name: 'Last' });
    within(modal()).getByRole('button', { name: 'Close News' }).focus();

    fireEvent.keyDown(modal(), { key: 'Tab', shiftKey: true });

    expect(lastLink).toHaveFocus();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LegalModal from './index';

/** Renders the modal showing `doc`, returning the close spy with RTL's helpers. */
function renderLegalModal(doc: 'privacy' | 'terms' | null) {
  const onClose = vi.fn();
  const view = render(<LegalModal doc={doc} onClose={onClose} />);
  return { ...view, onClose };
}

describe('LegalModal', () => {
  it('renders nothing when no document is selected', () => {
    const { container } = renderLegalModal(null);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the privacy policy on its own', () => {
    renderLegalModal('privacy');

    expect(screen.getByRole('dialog', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Terms of Service' })).not.toBeInTheDocument();
  });

  it('shows the terms of service on their own', () => {
    renderLegalModal('terms');

    expect(screen.getByRole('dialog', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Privacy Policy' })).not.toBeInTheDocument();
  });

  it('is a modal dialog, so assistive technology traps focus inside it', () => {
    renderLegalModal('privacy');

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('names the third-party services the browser actually contacts', () => {
    renderLegalModal('privacy');

    expect(screen.getByText('Open-Meteo')).toBeInTheDocument();
    expect(screen.getByText('allorigins.win')).toBeInTheDocument();
    expect(screen.getByText(/Google's favicon service/)).toBeInTheDocument();
  });

  it('carries a last-updated date on each document', () => {
    const { rerender } = renderLegalModal('privacy');
    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument();

    rerender(<LegalModal doc="terms" onClose={vi.fn()} />);

    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument();
  });
});

describe('LegalModal dismissal', () => {
  it('closes on the close button', () => {
    const { onClose } = renderLegalModal('privacy');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const { onClose } = renderLegalModal('terms');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const { onClose } = renderLegalModal('terms');

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a click on the backdrop', () => {
    const { container, onClose } = renderLegalModal('privacy');

    fireEvent.click(container.firstElementChild!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when the click lands on the document itself', () => {
    const { onClose } = renderLegalModal('privacy');

    // Selecting text in the policy must not dismiss it.
    fireEvent.click(screen.getByRole('dialog'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not listen for Escape while closed', () => {
    const { onClose } = renderLegalModal(null);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for Escape once unmounted', () => {
    const { unmount, onClose } = renderLegalModal('privacy');

    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LegalModal from './index';

describe('LegalModal', () => {
  it('renders nothing when no document is selected', () => {
    const { container } = render(<LegalModal doc={null} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the privacy policy', () => {
    render(<LegalModal doc="privacy" onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Terms of Service' })).not.toBeInTheDocument();
  });

  it('shows the terms of service', () => {
    render(<LegalModal doc="terms" onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Privacy Policy' })).not.toBeInTheDocument();
  });

  it('is a modal dialog, so assistive technology traps focus inside it', () => {
    render(<LegalModal doc="privacy" onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('names the third-party services the browser actually contacts', () => {
    render(<LegalModal doc="privacy" onClose={vi.fn()} />);

    expect(screen.getByText('Open-Meteo')).toBeInTheDocument();
    expect(screen.getByText('allorigins.win')).toBeInTheDocument();
    expect(screen.getByText(/Google's favicon service/)).toBeInTheDocument();
  });

  it('carries a last-updated date on each document', () => {
    const { rerender } = render(<LegalModal doc="privacy" onClose={vi.fn()} />);
    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument();

    rerender(<LegalModal doc="terms" onClose={vi.fn()} />);
    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument();
  });

  describe('dismissal', () => {
    it('closes on the close button', () => {
      const onClose = vi.fn();
      render(<LegalModal doc="privacy" onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape', () => {
      const onClose = vi.fn();
      render(<LegalModal doc="terms" onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores other keys', () => {
      const onClose = vi.fn();
      render(<LegalModal doc="terms" onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Enter' });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on a click on the backdrop', () => {
      const onClose = vi.fn();
      const { container } = render(<LegalModal doc="privacy" onClose={onClose} />);

      fireEvent.click(container.firstElementChild!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stays open when the click lands on the document itself', () => {
      const onClose = vi.fn();
      render(<LegalModal doc="privacy" onClose={onClose} />);

      // Selecting text in the policy must not dismiss it.
      fireEvent.click(screen.getByRole('dialog'));

      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not listen for Escape while closed', () => {
      const onClose = vi.fn();
      render(<LegalModal doc={null} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('stops listening for Escape once unmounted', () => {
      const onClose = vi.fn();
      const { unmount } = render(<LegalModal doc="privacy" onClose={onClose} />);

      unmount();
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Footer from './index';

describe('Footer', () => {
  it('names the app and its local-first promise', () => {
    render(<Footer onOpenLegal={vi.fn()} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Your day in one place')).toBeInTheDocument();
    expect(screen.getByText(/no analytics, no ads, no tracking/i)).toBeInTheDocument();
  });

  it('keeps what each service powers on hover, having dropped it from the type', () => {
    render(<Footer onOpenLegal={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Gmail' })).toHaveAttribute('title', 'mail, read-only');
    expect(screen.getByText('Public RSS')).toHaveAttribute('title', 'headlines');
  });

  it('draws its separators in CSS, so no stray middot survives in the text', () => {
    // The runs are built from lists; a dot typed into the markup would outlive
    // the item next to it.
    render(<Footer onOpenLegal={vi.fn()} />);
    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('credits the third-party services, linking the ones with a home page', () => {
    render(<Footer onOpenLegal={vi.fn()} />);
    const sources = screen.getByRole('navigation', { name: 'Data sources' });

    expect(within(sources).getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute(
      'href',
      'https://open-meteo.com',
    );
    expect(within(sources).getByRole('link', { name: 'Spotify' })).toBeInTheDocument();
    // The RSS feeds have no single home page, so that one stays plain text.
    expect(within(sources).getByText('Public RSS')).toBeInTheDocument();
    expect(within(sources).queryByRole('link', { name: 'Public RSS' })).not.toBeInTheDocument();
  });

  it('opens external sources in a new tab', () => {
    render(<Footer onOpenLegal={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'Open-Meteo' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('asks for each legal document by name', async () => {
    const onOpenLegal = vi.fn();
    const user = userEvent.setup();
    render(<Footer onOpenLegal={onOpenLegal} />);

    await user.click(screen.getByRole('button', { name: 'Privacy Policy' }));
    expect(onOpenLegal).toHaveBeenCalledWith('privacy');

    await user.click(screen.getByRole('button', { name: 'Terms of Service' }));
    expect(onOpenLegal).toHaveBeenCalledWith('terms');
  });

  it('labels its two link groups so they are distinguishable landmarks', () => {
    render(<Footer onOpenLegal={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Data sources' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Legal' })).toBeInTheDocument();
  });

  it('adds no headings, leaving the page outline to the dashboard', () => {
    render(<Footer onOpenLegal={vi.fn()} />);
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });
});

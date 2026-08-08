import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Footer from './index';

/** Renders the footer, returning the legal-document callback it can fire. */
function renderFooter() {
  const onOpenLegal = vi.fn();
  render(<Footer onOpenLegal={onOpenLegal} />);
  return { onOpenLegal };
}

/** The "Data sources" navigation landmark. */
const sourcesNav = () => screen.getByRole('navigation', { name: 'Data sources' });

describe('Footer', () => {
  it('names the app', () => {
    renderFooter();

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Your day in one place')).toBeInTheDocument();
  });

  it('states the local-first promise', () => {
    renderFooter();

    expect(screen.getByText(/no analytics, no ads, no tracking/i)).toBeInTheDocument();
  });

  it('keeps what each service powers on hover, having dropped it from the type', () => {
    renderFooter();

    expect(screen.getByRole('link', { name: 'Gmail' })).toHaveAttribute('title', 'mail, read-only');
    expect(screen.getByText('Public RSS')).toHaveAttribute('title', 'headlines');
  });

  it('draws its separators in CSS, so no stray middot survives in the text', () => {
    // The runs are built from lists; a dot typed into the markup would outlive
    // the item next to it.
    renderFooter();

    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('links each third-party service to its home page', () => {
    renderFooter();

    expect(within(sourcesNav()).getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute(
      'href',
      'https://open-meteo.com',
    );
    expect(within(sourcesNav()).getByRole('link', { name: 'Spotify' })).toBeInTheDocument();
  });

  it('credits a service with no home page as plain text', () => {
    renderFooter();

    // The RSS feeds have no single home page.
    expect(within(sourcesNav()).getByText('Public RSS')).toBeInTheDocument();
    expect(within(sourcesNav()).queryByRole('link', { name: 'Public RSS' })).not.toBeInTheDocument();
  });

  it('opens external sources in a new tab', () => {
    renderFooter();

    const link = screen.getByRole('link', { name: 'Open-Meteo' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('asks for the privacy policy by name', async () => {
    const { onOpenLegal } = renderFooter();

    await userEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));

    expect(onOpenLegal).toHaveBeenCalledWith('privacy');
  });

  it('asks for the terms of service by name', async () => {
    const { onOpenLegal } = renderFooter();

    await userEvent.click(screen.getByRole('button', { name: 'Terms of Service' }));

    expect(onOpenLegal).toHaveBeenCalledWith('terms');
  });

  it('labels its two link groups so they are distinguishable landmarks', () => {
    renderFooter();

    expect(screen.getByRole('navigation', { name: 'Data sources' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Legal' })).toBeInTheDocument();
  });

  it('adds no headings, leaving the page outline to the dashboard', () => {
    renderFooter();

    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });
});

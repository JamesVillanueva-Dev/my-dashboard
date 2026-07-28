import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickLinksWidget from './QuickLinksWidget';

describe('QuickLinksWidget', () => {
  it('renders the default bookmarks', () => {
    render(<QuickLinksWidget />);
    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Gmail/ })).toHaveAttribute(
      'href',
      'https://mail.google.com',
    );
  });

  it('adds a link, normalising a scheme-less URL to https', async () => {
    const user = userEvent.setup();
    render(<QuickLinksWidget />);

    await user.click(screen.getByTitle('Add link'));
    await user.type(screen.getByPlaceholderText('Label'), 'Example');
    await user.type(screen.getByPlaceholderText('example.com'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const link = screen.getByRole('link', { name: /Example/ });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(localStorage.getItem('quicklinks')).toContain('https://example.com');
  });

  it('does not add a link when a field is empty', async () => {
    const user = userEvent.setup();
    render(<QuickLinksWidget />);
    const before = screen.getAllByRole('link').length;

    await user.click(screen.getByTitle('Add link'));
    await user.type(screen.getByPlaceholderText('Label'), 'No URL');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getAllByRole('link')).toHaveLength(before);
  });

  it('removes a link', async () => {
    const user = userEvent.setup();
    render(<QuickLinksWidget />);

    const gmail = screen.getByText('Gmail').closest('.links__item')!;
    await user.click(within(gmail).getByTitle('Remove'));

    expect(screen.queryByText('Gmail')).not.toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickLinks from './index';

/** Opens the edit popover and returns it. */
async function openManager(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Manage quick links' }));
  return screen.getByRole('menu');
}

describe('QuickLinks', () => {
  it('renders the default bookmarks in the nav bar', () => {
    render(<QuickLinks />);
    const bar = screen.getByRole('navigation', { name: 'Quick links' });

    expect(within(bar).getByRole('link', { name: /Gmail/ })).toHaveAttribute(
      'href',
      'https://mail.google.com',
    );
    expect(within(bar).getByRole('link', { name: /GitHub/ })).toBeInTheDocument();
  });

  it('opens each link in a new tab', () => {
    render(<QuickLinks />);
    const link = screen.getByRole('link', { name: /Gmail/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('adds a link, normalising a scheme-less URL to https', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await user.type(screen.getByPlaceholderText('Label'), 'Example');
    await user.type(screen.getByPlaceholderText('example.com'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('link', { name: /Example/ })).toHaveAttribute(
      'href',
      'https://example.com',
    );
    expect(localStorage.getItem('quicklinks')).toContain('https://example.com');
  });

  it('does not add a link when a field is empty', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);
    const before = screen.getAllByRole('link').length;

    await openManager(user);
    await user.type(screen.getByPlaceholderText('Label'), 'No URL');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getAllByRole('link')).toHaveLength(before);
  });

  it('removes a link from the popover', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    const menu = await openManager(user);
    await user.click(within(menu).getByRole('button', { name: 'Remove Gmail' }));

    expect(screen.queryByRole('link', { name: /Gmail/ })).not.toBeInTheDocument();
  });

  it('stays open with a cleared form so several links can be added in a row', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await user.type(screen.getByPlaceholderText('Label'), 'One');
    await user.type(screen.getByPlaceholderText('example.com'), 'one.com{Enter}');

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Label')).toHaveValue('');
    expect(screen.getByPlaceholderText('example.com')).toHaveValue('');

    await user.type(screen.getByPlaceholderText('Label'), 'Two');
    await user.type(screen.getByPlaceholderText('example.com'), 'two.com{Enter}');

    expect(screen.getByRole('link', { name: /One/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Two/ })).toBeInTheDocument();
  });

  it('closes the popover on Escape', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

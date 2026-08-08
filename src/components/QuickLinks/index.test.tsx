import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickLinks from './index';

/** Opens the edit popover and returns it. */
async function openManager(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Manage quick links' }));
  return screen.getByRole('menu');
}

/** Fills the popover's two fields. */
async function typeNewLink(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  url: string,
  submit = false,
) {
  await user.type(screen.getByPlaceholderText('Label'), label);
  await user.type(screen.getByPlaceholderText('example.com'), submit ? `${url}{Enter}` : url);
}

/** The bookmark bar itself. */
const linkBar = () => screen.getByRole('navigation', { name: 'Quick links' });

describe('QuickLinks bookmark bar', () => {
  it('renders the default bookmarks', () => {
    render(<QuickLinks />);

    expect(within(linkBar()).getByRole('link', { name: /Gmail/ })).toHaveAttribute(
      'href',
      'https://mail.google.com',
    );
    expect(within(linkBar()).getByRole('link', { name: /GitHub/ })).toBeInTheDocument();
  });

  it('opens each link in a new tab', () => {
    render(<QuickLinks />);

    const link = screen.getByRole('link', { name: /Gmail/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});

describe('QuickLinks manager popover', () => {
  it('adds a link, normalising a scheme-less URL to https', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await typeNewLink(user, 'Example', 'example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('link', { name: /Example/ })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });

  it('persists the link it added', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await typeNewLink(user, 'Example', 'example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(localStorage.getItem('quicklinks')).toContain('https://example.com');
  });

  it('does not add a link when a field is empty', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);
    const linksBefore = screen.getAllByRole('link').length;

    await openManager(user);
    await user.type(screen.getByPlaceholderText('Label'), 'No URL');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getAllByRole('link')).toHaveLength(linksBefore);
  });

  it('removes a link', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    const menu = await openManager(user);
    await user.click(within(menu).getByRole('button', { name: 'Remove Gmail' }));

    expect(screen.queryByRole('link', { name: /Gmail/ })).not.toBeInTheDocument();
  });

  it('stays open with a cleared form after a save', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await typeNewLink(user, 'One', 'one.com', true);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Label')).toHaveValue('');
    expect(screen.getByPlaceholderText('example.com')).toHaveValue('');
  });

  it('lets several links be added in a row', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await typeNewLink(user, 'One', 'one.com', true);
    await typeNewLink(user, 'Two', 'two.com', true);

    expect(screen.getByRole('link', { name: /One/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Two/ })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<QuickLinks />);

    await openManager(user);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

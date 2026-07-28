import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeToggle from './ThemeToggle';

describe('ThemeToggle', () => {
  it('defaults to the light (black & yellow) theme and applies it to the root', () => {
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    // In light mode the button offers the moon (switch to dark).
    expect(screen.getByRole('button', { name: /toggle color theme/i })).toHaveTextContent('🌙');
  });

  it('toggles to the dark (purple) theme and persists the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: /toggle color theme/i }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('dark'));
    expect(screen.getByRole('button', { name: /toggle color theme/i })).toHaveTextContent('☀️');
  });
});

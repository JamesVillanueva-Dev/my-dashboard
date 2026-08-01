import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeToggle from './index';

describe('ThemeToggle', () => {
  it('defaults to the light (black & yellow) theme and applies it to the root', () => {
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    // The label names the theme the button switches *to*, not the current one.
    expect(screen.getByRole('button', { name: /toggle color theme/i })).toHaveTextContent('Dark');
  });

  it('toggles to the dark (purple) theme and persists the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: /toggle color theme/i }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('dark'));
    expect(screen.getByRole('button', { name: /toggle color theme/i })).toHaveTextContent('Light');
  });
});

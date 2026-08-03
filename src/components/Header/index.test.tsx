import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Header from './index';

describe('Header', () => {
  it('shows the current time', () => {
    render(<Header />);
    const clock = screen.getByLabelText('Current time');
    expect(clock).toHaveTextContent(/^\d{1,2}:\d{2}:\d{2}/);
  });

  it('renders extra actions passed in', () => {
    render(<Header actions={<button>Menu</button>} />);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FocusWidget from './FocusWidget';

describe('FocusWidget', () => {
  it('shows the daily quote with an attribution', () => {
    render(<FocusWidget />);
    const quote = screen.getByText(/—/);
    expect(quote).toBeInTheDocument();
  });

  it('saves the focus text as the user types', () => {
    render(<FocusWidget />);
    const input = screen.getByPlaceholderText('Set your intention');
    fireEvent.change(input, { target: { value: 'Ship the dashboard' } });
    expect(input).toHaveValue('Ship the dashboard');
    expect(localStorage.getItem('focus')).toContain('Ship the dashboard');
  });
});

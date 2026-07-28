import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import NotesWidget from './NotesWidget';

afterEach(() => {
  vi.useRealTimers();
});

describe('NotesWidget', () => {
  it('autosaves the text to localStorage as it changes', () => {
    render(<NotesWidget />);
    const area = screen.getByPlaceholderText(/Jot anything down/i);

    fireEvent.change(area, { target: { value: 'Remember the milk' } });

    expect(area).toHaveValue('Remember the milk');
    expect(localStorage.getItem('notes.text')).toContain('Remember the milk');
  });

  it('loads previously saved notes', () => {
    localStorage.setItem('notes.text', JSON.stringify('Earlier note'));
    render(<NotesWidget />);
    expect(screen.getByPlaceholderText(/Jot anything down/i)).toHaveValue('Earlier note');
  });

  it('flashes a saved indicator once typing settles', () => {
    vi.useFakeTimers();
    render(<NotesWidget />);

    // Nothing to save yet, so no indicator.
    expect(screen.queryByText('saved ✓')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Jot anything down/i), {
      target: { value: 'x' },
    });
    // While the debounce is pending the flash is hidden.
    expect(screen.queryByText('saved ✓')).not.toBeInTheDocument();

    // The 600ms settle timer fires and the indicator appears.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('saved ✓')).toBeInTheDocument();
  });
});

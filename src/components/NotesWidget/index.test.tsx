import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import NotesWidget from './index';

/** How long the widget waits after the last keystroke before flashing "saved". */
const SETTLE_MS = 600;

/** The note field. */
const noteField = () => screen.getByPlaceholderText(/Jot anything down/i);

/** Types into the note field. */
const typeNote = (text: string) => fireEvent.change(noteField(), { target: { value: text } });

afterEach(() => {
  vi.useRealTimers();
});

describe('NotesWidget', () => {
  it('shows what was typed', () => {
    render(<NotesWidget />);

    typeNote('Remember the milk');

    expect(noteField()).toHaveValue('Remember the milk');
  });

  it('autosaves the text to localStorage as it changes', () => {
    render(<NotesWidget />);

    typeNote('Remember the milk');

    expect(localStorage.getItem('notes.text')).toContain('Remember the milk');
  });

  it('loads a previously saved note', () => {
    localStorage.setItem('notes.text', JSON.stringify('Earlier note'));

    render(<NotesWidget />);

    expect(noteField()).toHaveValue('Earlier note');
  });

  it('shows no saved indicator before anything is typed', () => {
    render(<NotesWidget />);

    expect(screen.queryByText('saved')).not.toBeInTheDocument();
  });

  it('holds the saved indicator back while typing is still settling', () => {
    vi.useFakeTimers();
    render(<NotesWidget />);

    typeNote('x');

    expect(screen.queryByText('saved')).not.toBeInTheDocument();
  });

  it('flashes the saved indicator once typing settles', () => {
    vi.useFakeTimers();
    render(<NotesWidget />);
    typeNote('x');

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });

    expect(screen.getByText('saved')).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatStrip from './index';
import styles from './styles.module.css';
import type { AgendaCounts } from '../../lib/agenda';

const counts = (over: Partial<AgendaCounts> = {}): AgendaCounts => ({
  remainingToday: 0,
  overdue: 0,
  eventsLeft: 0,
  undated: 0,
  ...over,
});

describe('StatStrip', () => {
  it('shows an all-clear line when every figure is zero', () => {
    render(<StatStrip counts={counts()} />);
    expect(screen.getByText('Nothing left today.')).toBeInTheDocument();
  });

  it('omits zero-valued figures rather than printing "0"', () => {
    render(<StatStrip counts={counts({ remainingToday: 3 })} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('events left')).not.toBeInTheDocument();
    expect(screen.queryByText('overdue')).not.toBeInTheDocument();
  });

  it('singularises labels for a count of one', () => {
    render(<StatStrip counts={counts({ remainingToday: 1, eventsLeft: 1 })} />);
    expect(screen.getByText('task left')).toBeInTheDocument();
    expect(screen.getByText('event left')).toBeInTheDocument();
  });

  it('flags overdue as urgent, and nothing else', () => {
    render(<StatStrip counts={counts({ overdue: 2, remainingToday: 5 })} />);
    expect(screen.getByText('overdue').closest('li')).toHaveClass(styles.isUrgent);
    expect(screen.getByText('tasks left').closest('li')).not.toHaveClass(styles.isUrgent);
  });
});

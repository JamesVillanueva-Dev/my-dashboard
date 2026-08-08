import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatStrip from './index';
import styles from './styles.module.css';
import type { AgendaCounts } from '../../lib/agenda';

const counts = (overrides: Partial<AgendaCounts> = {}): AgendaCounts => ({
  remainingToday: 0,
  overdue: 0,
  eventsLeft: 0,
  undated: 0,
  ...overrides,
});

/** The list item a given label sits in. */
const figureFor = (label: string) => screen.getByText(label).closest('li');

describe('StatStrip', () => {
  it('renders nothing when every figure is zero', () => {
    // The Today zone says the day is empty twice already, in the headline and
    // in the timeline's empty state; a third line between them was repetition.
    const { container } = render(<StatStrip counts={counts()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a figure that has something to report', () => {
    render(<StatStrip counts={counts({ remainingToday: 3 })} />);

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('omits zero-valued figures rather than printing "0"', () => {
    render(<StatStrip counts={counts({ remainingToday: 3 })} />);

    expect(screen.queryByText('events left')).not.toBeInTheDocument();
    expect(screen.queryByText('overdue')).not.toBeInTheDocument();
  });

  it('singularises labels for a count of one', () => {
    render(<StatStrip counts={counts({ remainingToday: 1, eventsLeft: 1 })} />);

    expect(screen.getByText('task left')).toBeInTheDocument();
    expect(screen.getByText('event left')).toBeInTheDocument();
  });

  it('flags the overdue figure as urgent', () => {
    render(<StatStrip counts={counts({ overdue: 2, remainingToday: 5 })} />);

    expect(figureFor('overdue')).toHaveClass(styles.isUrgent);
  });

  it('leaves the other figures unflagged', () => {
    render(<StatStrip counts={counts({ overdue: 2, remainingToday: 5 })} />);

    expect(figureFor('tasks left')).not.toHaveClass(styles.isUrgent);
  });
});

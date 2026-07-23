import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TodoWidget from './TodoWidget';

describe('TodoWidget', () => {
  it('adds a task and shows the remaining count', async () => {
    const user = userEvent.setup();
    render(<TodoWidget />);
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Add a task…'), 'Buy milk');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(screen.getByText('1 left')).toBeInTheDocument();
    expect(localStorage.getItem('todos')).toContain('Buy milk');
  });

  it('adds on Enter and ignores blank input', async () => {
    const user = userEvent.setup();
    render(<TodoWidget />);
    const input = screen.getByPlaceholderText('Add a task…');

    await user.type(input, '   {Enter}');
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();

    await user.type(input, 'Walk dog{Enter}');
    expect(screen.getByText('Walk dog')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('completing a task lowers the count and sinks it to the bottom', async () => {
    const user = userEvent.setup();
    render(<TodoWidget />);
    await user.type(screen.getByPlaceholderText('Add a task…'), 'First{Enter}');
    await user.type(screen.getByPlaceholderText('Add a task…'), 'Second{Enter}');

    // Newest is on top: order is Second, First.
    const doneItem = screen.getByText('Second').closest('li')!;
    await user.click(within(doneItem).getByRole('checkbox'));

    expect(screen.getByText('1 left')).toBeInTheDocument();
    expect(screen.getByText('Second').closest('li')).toHaveClass('is-done');

    // Completed task drops below the incomplete one.
    const texts = screen.getAllByText(/First|Second/).map((el) => el.textContent);
    expect(texts).toEqual(['First', 'Second']);
  });

  it('removes a task', async () => {
    const user = userEvent.setup();
    render(<TodoWidget />);
    await user.type(screen.getByPlaceholderText('Add a task…'), 'Delete me{Enter}');

    await user.click(screen.getByTitle('Delete'));
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
  });
});

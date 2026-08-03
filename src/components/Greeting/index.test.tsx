import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Greeting from './index';

describe('Greeting', () => {
  it('shows a time-of-day greeting and the user name', () => {
    render(<Greeting name="Sam" onNameChange={() => {}} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/Good (morning|afternoon|evening|night)/);
    expect(screen.getByRole('button', { name: 'Sam' })).toBeInTheDocument();
  });

  it('falls back to "friend" when no name is set', () => {
    render(<Greeting name="" onNameChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'friend' })).toBeInTheDocument();
  });

  it('lets the user edit their name inline', async () => {
    const onNameChange = vi.fn();
    const user = userEvent.setup();
    render(<Greeting name="Sam" onNameChange={onNameChange} />);

    await user.click(screen.getByRole('button', { name: 'Sam' }));
    const input = screen.getByPlaceholderText('your name');
    fireEvent.change(input, { target: { value: 'Sammy' } });

    expect(onNameChange).toHaveBeenCalledWith('Sammy');
  });
});

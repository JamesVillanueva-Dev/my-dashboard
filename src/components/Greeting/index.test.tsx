import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Greeting from './index';

describe('Greeting', () => {
  it('greets the user for the time of day', () => {
    render(<Greeting name="Sam" onNameChange={() => {}} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /Good (morning|afternoon|evening|night)/,
    );
  });

  it('shows the name it was given', () => {
    render(<Greeting name="Sam" onNameChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Sam' })).toBeInTheDocument();
  });

  it('falls back to "friend" when no name is set', () => {
    render(<Greeting name="" onNameChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'friend' })).toBeInTheDocument();
  });

  it('reports a name edited inline', async () => {
    const onNameChange = vi.fn();
    const user = userEvent.setup();
    render(<Greeting name="Sam" onNameChange={onNameChange} />);

    await user.click(screen.getByRole('button', { name: 'Sam' }));
    fireEvent.change(screen.getByPlaceholderText('your name'), { target: { value: 'Sammy' } });

    expect(onNameChange).toHaveBeenCalledWith('Sammy');
  });
});

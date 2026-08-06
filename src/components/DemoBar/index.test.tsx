import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoBar from './index';

describe('DemoBar', () => {
  it('says plainly that nothing is being kept', () => {
    render(<DemoBar onExit={vi.fn()} onSignIn={vi.fn()} />);
    // The point of the bar: nobody should furnish a dashboard for an afternoon
    // before finding out it was never going to be saved.
    expect(screen.getByText(/nothing here is saved to an account/i)).toBeInTheDocument();
  });

  it('leaves the demo on request', async () => {
    const onExit = vi.fn();
    render(<DemoBar onExit={onExit} onSignIn={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /exit demo/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('offers sign-in from inside the demo, without promising it will save anything', async () => {
    const onSignIn = vi.fn();
    render(<DemoBar onExit={vi.fn()} onSignIn={onSignIn} />);

    const button = screen.getByRole('button', { name: 'Sign in' });
    // Not "sign in to keep it" — sign-in is restricted to accounts added by
    // hand, so most visitors cannot keep anything.
    expect(button).not.toHaveTextContent(/keep/i);

    await userEvent.click(button);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('is a labelled landmark, so it can be skipped', () => {
    render(<DemoBar onExit={vi.fn()} onSignIn={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Demo mode' })).toBeInTheDocument();
  });
});

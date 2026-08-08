import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoBar from './index';

/** Renders the bar, returning the two callbacks it can fire. */
function renderDemoBar() {
  const onExit = vi.fn();
  const onSignIn = vi.fn();
  render(<DemoBar onExit={onExit} onSignIn={onSignIn} />);
  return { onExit, onSignIn };
}

describe('DemoBar', () => {
  it('says plainly that nothing is being kept', () => {
    renderDemoBar();

    // The point of the bar: nobody should furnish a dashboard for an afternoon
    // before finding out it was never going to be saved.
    expect(screen.getByText(/nothing here is saved to an account/i)).toBeInTheDocument();
  });

  it('leaves the demo on request', async () => {
    const { onExit } = renderDemoBar();

    await userEvent.click(screen.getByRole('button', { name: /exit demo/i }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('offers sign-in from inside the demo', async () => {
    const { onSignIn } = renderDemoBar();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not promise that signing in will save anything', () => {
    renderDemoBar();

    // Not "sign in to keep it" — sign-in is restricted to accounts added by
    // hand, so most visitors cannot keep anything.
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveTextContent(/keep/i);
  });

  it('is a labelled landmark, so it can be skipped', () => {
    renderDemoBar();

    expect(screen.getByRole('region', { name: 'Demo mode' })).toBeInTheDocument();
  });
});

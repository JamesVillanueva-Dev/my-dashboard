import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LandingPage from './index';

/** Renders with both callbacks stubbed, returning them for assertions. */
function renderLandingPage() {
  const onTryDemo = vi.fn();
  const onSignIn = vi.fn();
  render(<LandingPage onTryDemo={onTryDemo} onSignIn={onSignIn} />);
  return { onTryDemo, onSignIn };
}

/** Every "Try the live demo" button on the page. */
const demoButtons = () => screen.getAllByRole('button', { name: /try the live demo/i });

/** Every "Sign in" button on the page. */
const signInButtons = () => screen.getAllByRole('button', { name: 'Sign in' });

describe('LandingPage headline and calls to action', () => {
  it('leads with what the app is, in one heading', () => {
    renderLandingPage();

    const headings = screen.getAllByRole('heading', { level: 1 });
    // Exactly one h1 — the page outline should not compete with itself.
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/your whole day/i);
  });

  it('opens the demo when asked', async () => {
    const { onTryDemo } = renderLandingPage();

    await userEvent.click(demoButtons()[0]);

    expect(onTryDemo).toHaveBeenCalledTimes(1);
  });

  it('offers sign-in for people who already have an account', async () => {
    const { onSignIn } = renderLandingPage();

    await userEvent.click(signInButtons()[0]);

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('repeats both calls to action at the bottom, for anyone who read to the end', () => {
    renderLandingPage();

    expect(demoButtons()).toHaveLength(2);
    expect(signInButtons()).toHaveLength(2);
  });
});

describe('LandingPage promises about the demo and sign-in', () => {
  it('says up front that the demo needs no account and keeps nothing', () => {
    renderLandingPage();

    expect(screen.getByText(/no account, no email/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing it does is saved to an account/i)).toBeInTheDocument();
  });

  it('warns that sign-in will not work', () => {
    renderLandingPage();

    const notice = screen.getByText(/personal project, not a product/i).closest('p')!;
    expect(notice).toHaveTextContent(/will not get you in/i);
    expect(notice).toHaveTextContent(/no way to sign up/i);
  });

  it('puts that warning before the sign-in button, not after it', () => {
    renderLandingPage();

    // Someone who misses it reaches a form that cannot help them.
    const notice = screen.getByText(/personal project, not a product/i).closest('p')!;
    const signIn = signInButtons()[0];
    expect(signIn.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('answers the sign-up question directly in the FAQ too', () => {
    renderLandingPage();

    const question = screen.getByText('Can I sign up?');
    expect(question.nextElementSibling).toHaveTextContent(/restricted to a few accounts/i);
  });

  it('does not promise that signing in will keep your demo', () => {
    renderLandingPage();

    expect(screen.queryByText(/sign in from inside it/i)).not.toBeInTheDocument();
  });
});

describe('LandingPage feature tour', () => {
  it('describes each panel the dashboard actually has', () => {
    renderLandingPage();

    for (const panel of ['Tasks', 'Calendar', 'Weather', 'News', 'Mail', 'Notes']) {
      expect(screen.getByRole('heading', { level: 3, name: panel })).toBeInTheDocument();
    }
  });

  it('says the Mail panel scores in the browser', () => {
    renderLandingPage();

    const mail = screen.getByRole('heading', { level: 3, name: 'Mail' }).parentElement!;
    expect(within(mail).getByText(/scored right here in your browser/i)).toBeInTheDocument();
  });

  it('does not claim the Mail panel uses an AI, because it no longer does', () => {
    // ADR 0010 removed the model. A landing page that oversells is a bug report
    // waiting to be filed.
    renderLandingPage();

    const mail = screen.getByRole('heading', { level: 3, name: 'Mail' }).parentElement!;
    expect(mail.textContent).not.toMatch(/\bAI\b|Claude|Anthropic/);
  });

  it('names the privacy position without hiding behind the word private', () => {
    renderLandingPage();

    expect(
      screen.getByRole('heading', { level: 2, name: /no analytics, no ads, no tracking/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/there is no server of ours/i)).toBeInTheDocument();
  });
});

describe('LandingPage structure', () => {
  it('keeps every section reachable as a labelled landmark', () => {
    renderLandingPage();

    // Each section is labelled by its own heading, so a screen reader can jump
    // between them rather than walking the whole page.
    expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(4);
  });

  it('reaches the legal documents without leaving the page', async () => {
    renderLandingPage();

    await userEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));

    expect(screen.getByRole('dialog', { name: 'Privacy Policy' })).toBeInTheDocument();
  });
});

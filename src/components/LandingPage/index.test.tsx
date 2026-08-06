import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LandingPage from './index';

/** Renders with both callbacks stubbed, returning them for assertions. */
function renderPage() {
  const onTryDemo = vi.fn();
  const onSignIn = vi.fn();
  render(<LandingPage onTryDemo={onTryDemo} onSignIn={onSignIn} />);
  return { onTryDemo, onSignIn };
}

describe('LandingPage', () => {
  it('leads with what the app is, in one heading', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 1 });
    // Exactly one h1 — the page outline should not compete with itself.
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/your whole day/i);
  });

  it('offers the demo before it offers sign-in', async () => {
    const { onTryDemo } = renderPage();
    await userEvent.click(screen.getAllByRole('button', { name: /try the live demo/i })[0]);
    expect(onTryDemo).toHaveBeenCalledTimes(1);
  });

  it('offers sign-in for people who already have an account', async () => {
    const { onSignIn } = renderPage();
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign in' })[0]);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('repeats both calls to action at the bottom, for anyone who read to the end', () => {
    renderPage();
    expect(screen.getAllByRole('button', { name: /try the live demo/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(2);
  });

  it('says up front that the demo needs no account and keeps nothing', () => {
    renderPage();
    expect(screen.getByText(/no account, no email/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing it does is saved to an account/i)).toBeInTheDocument();
  });

  it('warns that sign-in will not work before the visitor tries it', () => {
    renderPage();
    // Must be next to the sign-in button, not buried in the FAQ — someone who
    // misses it reaches a form that cannot help them.
    const notice = screen.getByText(/personal project, not a product/i).closest('p')!;
    expect(notice).toHaveTextContent(/will not get you in/i);
    expect(notice).toHaveTextContent(/no way to sign up/i);

    const signIn = screen.getAllByRole('button', { name: 'Sign in' })[0];
    expect(signIn.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('answers the sign-up question directly in the FAQ too', () => {
    renderPage();
    const question = screen.getByText('Can I sign up?');
    expect(question.nextElementSibling).toHaveTextContent(/restricted to a few accounts/i);
  });

  it('does not promise that signing in will keep your demo', () => {
    renderPage();
    expect(screen.queryByText(/sign in from inside it/i)).not.toBeInTheDocument();
  });

  it('describes each panel the dashboard actually has', () => {
    renderPage();
    for (const panel of ['Tasks', 'Calendar', 'Weather', 'News', 'Mail', 'Notes']) {
      expect(screen.getByRole('heading', { level: 3, name: panel })).toBeInTheDocument();
    }
  });

  it('does not claim the Mail panel uses an AI, because it no longer does', () => {
    // ADR 0010 removed the model. A landing page that oversells is a bug report
    // waiting to be filed.
    renderPage();
    const mail = screen.getByRole('heading', { level: 3, name: 'Mail' }).parentElement!;
    expect(within(mail).getByText(/scored right here in your browser/i)).toBeInTheDocument();
    expect(mail.textContent).not.toMatch(/\bAI\b|Claude|Anthropic/);
  });

  it('names the privacy position without hiding behind the word private', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 2, name: /no analytics, no ads, no tracking/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/there is no server of ours/i)).toBeInTheDocument();
  });

  it('keeps every section reachable as a labelled landmark', () => {
    renderPage();
    // Each section is labelled by its own heading, so a screen reader can jump
    // between them rather than walking the whole page.
    const regions = screen.getAllByRole('region');
    expect(regions.length).toBeGreaterThanOrEqual(4);
  });

  it('reaches the legal documents without leaving the page', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));
    expect(screen.getByRole('dialog', { name: 'Privacy Policy' })).toBeInTheDocument();
  });
});

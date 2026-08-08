import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import AuthGate from './index';

// Both flags are flipped per test to cover the three states the gate can be in:
// auth off, auth on + signed out, auth on + signed in.
const auth = vi.hoisted(() => ({ configured: true, signedIn: false }));

vi.mock('../../lib/clerkAuth', () => ({
  hasClerkKey: () => auth.configured,
  CLERK_PUBLISHABLE_KEY: 'pk_test_stub',
}));

// Stand in for Clerk's components so tests stay offline — the real ones fetch
// clerk-js from Clerk's CDN.
vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) =>
    auth.signedIn ? <>{children}</> : null,
  SignedOut: ({ children }: { children: React.ReactNode }) =>
    auth.signedIn ? null : <>{children}</>,
  SignIn: () => <div>Clerk sign-in form</div>,
  useUser: () => ({ isLoaded: true, user: auth.signedIn ? { id: 'user_a' } : null }),
}));

/** A stand-in dashboard that persists something, so we can see which key it used. */
function Child() {
  const [notes, setNotes] = useLocalStorage<string>('notes.text', '');
  return <button onClick={() => setNotes('written')}>notes: {notes || 'empty'}</button>;
}

/** Renders the gate around the probe child. */
function renderAuthGate() {
  return render(
    <AuthGate>
      <Child />
    </AuthGate>,
  );
}

/** The probe child, which only the real dashboard renders. */
const dashboardProbe = () => screen.queryByRole('button', { name: /notes:/ });

/** The landing page's headline. */
const landingHeading = () => screen.getByRole('heading', { level: 1 });

beforeEach(() => {
  auth.configured = true;
  auth.signedIn = false;
});

describe('AuthGate when Clerk is not configured', () => {
  beforeEach(() => {
    auth.configured = false;
  });

  it('renders the app directly', () => {
    renderAuthGate();

    expect(dashboardProbe()).toBeInTheDocument();
    expect(screen.queryByText('Clerk sign-in form')).not.toBeInTheDocument();
  });

  it('stores data unscoped', () => {
    renderAuthGate();

    expect(localStorage.getItem('notes.text')).toBe(JSON.stringify(''));
  });
});

describe('AuthGate when signed out', () => {
  it('lands a visitor on the landing page, not on a login form', () => {
    renderAuthGate();

    expect(landingHeading()).toHaveTextContent(/your whole day/i);
    // Neither the app nor a form is asked for before anything is explained.
    expect(dashboardProbe()).not.toBeInTheDocument();
    expect(screen.queryByText('Clerk sign-in form')).not.toBeInTheDocument();
  });

  it('reaches the sign-in form from the landing page', async () => {
    const user = userEvent.setup();
    renderAuthGate();

    await user.click(screen.getAllByRole('button', { name: 'Sign in' })[0]);

    expect(screen.getByText('Clerk sign-in form')).toBeInTheDocument();
    // Repeated here because someone can land straight on this view.
    expect(screen.getByText(/only accounts added by hand/i)).toBeInTheDocument();
  });

  it('goes back to the landing page from the sign-in form', async () => {
    const user = userEvent.setup();
    renderAuthGate();
    await user.click(screen.getAllByRole('button', { name: 'Sign in' })[0]);

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(landingHeading()).toHaveTextContent(/your whole day/i);
  });
});

describe('AuthGate demo mode', () => {
  /** Enters the demo from the landing page. */
  const enterDemo = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getAllByRole('button', { name: /try the live demo/i })[0]);

  it('opens the real dashboard, reading the seeded sample data', async () => {
    const user = userEvent.setup();
    renderAuthGate();

    await enterDemo(user);

    // The same child the signed-in path renders — not a mock-up of it.
    expect(
      screen.getByRole('button', { name: /notes: Ideas for the offsite/ }),
    ).toBeInTheDocument();
  });

  it('keeps the demo under its own storage scope', async () => {
    const user = userEvent.setup();
    renderAuthGate();

    await enterDemo(user);

    expect(localStorage.getItem('demo:notes.text')).toContain('offsite');
    // Nothing landed in the unscoped namespace a real account would adopt.
    expect(localStorage.getItem('notes.text')).toBeNull();
  });

  it('discards the demo on the way out', async () => {
    const user = userEvent.setup();
    renderAuthGate();
    await enterDemo(user);
    expect(localStorage.getItem('demo:layout')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /exit demo/i }));

    expect(landingHeading()).toHaveTextContent(/your whole day/i);
    expect(Object.keys(localStorage).some((key) => key.startsWith('demo:'))).toBe(false);
  });

  it('never carries the demo into an account that signs in afterwards', () => {
    // `adoptLegacyKeys` migrates unscoped keys on first sign-in. Demo keys carry
    // a scope already, so a visitor who tries the demo and then signs in must
    // not inherit a dashboard full of sample tasks.
    localStorage.setItem('demo:notes.text', JSON.stringify('sample data'));
    auth.signedIn = true;

    renderAuthGate();

    expect(screen.getByRole('button', { name: 'notes: empty' })).toBeInTheDocument();
    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify(''));
    expect(localStorage.getItem('demo:notes.text')).toBe(JSON.stringify('sample data'));
  });
});

describe('AuthGate when signed in', () => {
  beforeEach(() => {
    auth.signedIn = true;
  });

  it('renders the app', () => {
    renderAuthGate();

    expect(dashboardProbe()).toBeInTheDocument();
    expect(screen.queryByText('Clerk sign-in form')).not.toBeInTheDocument();
  });

  it('namespaces the user’s data', () => {
    renderAuthGate();

    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify(''));
    expect(localStorage.getItem('notes.text')).toBeNull();
  });

  it('adopts pre-auth data on first sign-in, before children read storage', () => {
    localStorage.setItem('notes.text', JSON.stringify('written before auth'));

    renderAuthGate();

    // The child must show the migrated value, not an empty default.
    expect(screen.getByRole('button', { name: 'notes: written before auth' })).toBeInTheDocument();
    expect(localStorage.getItem('notes.text')).toBeNull();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import AuthGate from './index';

// Both flags are flipped per test to cover the three states the gate can be in:
// auth off, auth on + signed out, auth on + signed in.
const state = vi.hoisted(() => ({ configured: true, signedIn: false }));

vi.mock('../../lib/clerkAuth', () => ({
  hasClerkKey: () => state.configured,
  CLERK_PUBLISHABLE_KEY: 'pk_test_stub',
}));

// Stand in for Clerk's components so tests stay offline — the real ones fetch
// clerk-js from Clerk's CDN.
vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (state.signedIn ? <>{children}</> : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (state.signedIn ? null : <>{children}</>),
  SignIn: () => <div>Clerk sign-in form</div>,
  useUser: () => ({ isLoaded: true, user: state.signedIn ? { id: 'user_a' } : null }),
}));

/** A stand-in dashboard that persists something, so we can see which key it used. */
function Child() {
  const [notes, setNotes] = useLocalStorage<string>('notes.text', '');
  return <button onClick={() => setNotes('written')}>notes: {notes || 'empty'}</button>;
}

describe('AuthGate', () => {
  beforeEach(() => {
    state.configured = true;
    state.signedIn = false;
  });

  it('renders the app directly when Clerk is not configured', () => {
    state.configured = false;
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    expect(screen.getByRole('button', { name: /notes:/ })).toBeInTheDocument();
    expect(screen.queryByText('Clerk sign-in form')).not.toBeInTheDocument();
  });

  it('stores data unscoped when Clerk is not configured', async () => {
    state.configured = false;
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    expect(localStorage.getItem('notes.text')).toBe(JSON.stringify(''));
  });

  it('lands a signed-out visitor on the landing page, not on a login form', () => {
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/your whole day/i);
    // Neither the app nor a form is asked for before anything is explained.
    expect(screen.queryByRole('button', { name: /notes:/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Clerk sign-in form')).not.toBeInTheDocument();
  });

  it('reaches the sign-in form from the landing page, and back again', async () => {
    const user = userEvent.setup();
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );

    await user.click(screen.getAllByRole('button', { name: 'Sign in' })[0]);
    expect(screen.getByText('Clerk sign-in form')).toBeInTheDocument();
    // Repeated here because someone can land straight on this view.
    expect(screen.getByText(/only accounts added by hand/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/your whole day/i);
  });

  it('opens the real dashboard in the demo, under its own storage scope', async () => {
    const user = userEvent.setup();
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );

    await user.click(screen.getAllByRole('button', { name: /try the live demo/i })[0]);

    // The same child the signed-in path renders — not a mock-up of it — and it
    // is reading the seeded sample data.
    expect(screen.getByRole('button', { name: /notes: Ideas for the offsite/ })).toBeInTheDocument();
    expect(localStorage.getItem('demo:notes.text')).toContain('offsite');
    // Nothing landed in the unscoped namespace a real account would adopt.
    expect(localStorage.getItem('notes.text')).toBeNull();
  });

  it('discards the demo on the way out', async () => {
    const user = userEvent.setup();
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );

    await user.click(screen.getAllByRole('button', { name: /try the live demo/i })[0]);
    expect(localStorage.getItem('demo:layout')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /exit demo/i }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/your whole day/i);
    expect(Object.keys(localStorage).some((k) => k.startsWith('demo:'))).toBe(false);
  });

  it('never carries the demo into an account that signs in afterwards', () => {
    // `adoptLegacyKeys` migrates unscoped keys on first sign-in. Demo keys carry
    // a scope already, so a visitor who tries the demo and then signs in must
    // not inherit a dashboard full of sample tasks.
    localStorage.setItem('demo:notes.text', JSON.stringify('sample data'));
    state.signedIn = true;

    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );

    expect(screen.getByRole('button', { name: 'notes: empty' })).toBeInTheDocument();
    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify(''));
    expect(localStorage.getItem('demo:notes.text')).toBe(JSON.stringify('sample data'));
  });

  it('renders the app once signed in', () => {
    state.signedIn = true;
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    expect(screen.getByRole('button', { name: /notes:/ })).toBeInTheDocument();
    expect(screen.queryByText('Clerk sign-in form')).not.toBeInTheDocument();
  });

  it('namespaces the signed-in user’s data', () => {
    state.signedIn = true;
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify(''));
    expect(localStorage.getItem('notes.text')).toBeNull();
  });

  it('adopts pre-auth data on first sign-in, before children read storage', () => {
    localStorage.setItem('notes.text', JSON.stringify('written before auth'));
    state.signedIn = true;

    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );

    // The child must show the migrated value, not an empty default.
    expect(screen.getByRole('button', { name: 'notes: written before auth' })).toBeInTheDocument();
    expect(localStorage.getItem('notes.text')).toBeNull();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('shows the sign-in form instead of the app when signed out', () => {
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    expect(screen.getByText('Clerk sign-in form')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /notes:/ })).not.toBeInTheDocument();
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

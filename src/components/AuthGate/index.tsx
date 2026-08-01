import { useState, type ReactNode } from 'react';
import { SignIn, SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { StorageScopeProvider, adoptLegacyKeys } from '../../hooks/useLocalStorage';
import { hasClerkKey } from '../../lib/clerkAuth';
import styles from './styles.module.css';

/** Props for {@link AuthGate}. */
interface AuthGateProps {
  /** The app to show once the user is signed in (or immediately, when auth is off). */
  children: ReactNode;
}

/** Props for {@link Scope}. */
interface ScopeProps extends AuthGateProps {
  /** The signed-in user's id; always non-empty here. */
  scope: string;
}

/**
 * Publishes one account's storage namespace to the app below it.
 *
 * Mounted with `key={scope}`, so React remounts it whenever the account changes
 * and the `useState` initializer below runs exactly once per account — during
 * this component's first render, i.e. *before* `children` mount and read
 * storage. An effect would be too late: the widgets would already have read the
 * empty namespace and would render (and then persist) their defaults.
 *
 * @param props - See {@link ScopeProps}.
 */
function Scope({ scope, children }: ScopeProps) {
  useState(() => adoptLegacyKeys(scope));

  return <StorageScopeProvider value={scope}>{children}</StorageScopeProvider>;
}

/**
 * Namespaces the app's persisted state to the signed-in user.
 *
 * Rendered only inside `<SignedIn>`, so Clerk has loaded and a user exists. The
 * remount on account switch also drops any in-memory widget state (a half-typed
 * note, fetched weather) belonging to the previous user.
 *
 * @param props - See {@link AuthGateProps}.
 */
function ScopedApp({ children }: AuthGateProps) {
  const { user } = useUser();
  const scope = user?.id ?? '';

  if (!scope) return null;

  return (
    <Scope key={scope} scope={scope}>
      {children}
    </Scope>
  );
}

/**
 * Decides whether the dashboard sits behind a Clerk sign-in.
 *
 * Authentication is opt-in (ADR 0003): with no `VITE_CLERK_PUBLISHABLE_KEY` this
 * renders `children` unchanged, keeping the zero-setup, unscoped behaviour the
 * app has always had. With a key set, the dashboard requires a signed-in user and
 * that user's data is stored under their own namespace.
 *
 * @param props - See {@link AuthGateProps}.
 */
export default function AuthGate({ children }: AuthGateProps) {
  if (!hasClerkKey()) return <>{children}</>;

  return (
    <>
      <SignedOut>
        <div className={styles.container}>
          <h1>Dashboard</h1>
          <p>Sign in to load your widgets, notes, and reminders.</p>
          <SignIn routing="virtual" />
        </div>
      </SignedOut>
      <SignedIn>
        <ScopedApp>{children}</ScopedApp>
      </SignedIn>
    </>
  );
}

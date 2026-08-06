import { useState, type ReactNode } from 'react';
import { SignIn, SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { StorageScopeProvider, adoptLegacyKeys } from '../../hooks/useLocalStorage';
import {
  ProfileSyncProvider,
  useProfileSync,
  type SyncUser,
} from '../../hooks/useProfileSync';
import { hasClerkKey } from '../../lib/clerkAuth';
import { useTheme } from '../../hooks/useTheme';
import { DEMO_SCOPE, clearDemo, seedDemo } from '../../lib/demo';
import LandingPage from '../LandingPage';
import DemoBar from '../DemoBar';
import Icon from '../Icon';
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
  /** The signed-in user, whose account carries the synced dashboard. */
  user: SyncUser;
}

/**
 * Publishes one account's storage namespace to the app below it, and mirrors
 * that namespace to the account itself.
 *
 * Mounted with `key={scope}`, so React remounts it whenever the account changes
 * and the `useState` initializer below runs exactly once per account — during
 * this component's first render, i.e. *before* `children` mount and read
 * storage. An effect would be too late: the widgets would already have read the
 * empty namespace and would render (and then persist) their defaults.
 *
 * Both calls below hydrate storage *during this render*, and their order is
 * load-bearing: `adoptLegacyKeys` must move the pre-auth dashboard into this
 * account's namespace before `useProfileSync` collects it, or that data reads as
 * absent and loses to whatever the account already held.
 *
 * @param props - See {@link ScopeProps}.
 */
function Scope({ scope, user, children }: ScopeProps) {
  useState(() => adoptLegacyKeys(scope));
  const sync = useProfileSync(user);

  return (
    <ProfileSyncProvider value={sync}>
      <StorageScopeProvider value={scope}>{children}</StorageScopeProvider>
    </ProfileSyncProvider>
  );
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

  if (!user || !scope) return null;

  return (
    <Scope key={scope} scope={scope} user={user}>
      {children}
    </Scope>
  );
}

/** What a signed-out visitor is currently looking at. */
type SignedOutView = 'landing' | 'signin' | 'demo';

/**
 * The sign-in screen, reached from the landing page.
 *
 * Its own component so it can call {@link useTheme} — a signed-out visitor has
 * no dashboard mounted to apply their palette, and this view can be the first
 * thing rendered if someone returns straight to it.
 *
 * @param props.onBack - Returns to the landing page.
 */
function SignInScreen({ onBack }: { onBack: () => void }) {
  useTheme();

  return (
    <div className={styles.container}>
      <button className={styles.back} onClick={onBack}>
        <Icon name="chevronLeft" />
        Back
      </button>
      <h1>Welcome back</h1>
      <p>
        Sign in to load your widgets, notes, and reminders. This is a personal project —
        only accounts added by hand can get in, so an outside account will be turned away.
      </p>
      <SignIn routing="virtual" />
    </div>
  );
}

/**
 * Everything a signed-out visitor can see: the landing page, the sign-in form,
 * or the demo.
 *
 * The demo is the real {@link children} — the same `Dashboard` a signed-in user
 * gets — mounted under {@link DEMO_SCOPE}. That scope is what keeps it honest in
 * both directions: the sample data cannot reach a real account, and a visitor
 * who signs in afterwards does not inherit a dashboard full of someone else's
 * pretend tasks. `adoptLegacyKeys` skips it for the same reason it skips every
 * other already-scoped key.
 *
 * @param props - See {@link AuthGateProps}.
 */
function SignedOutApp({ children }: AuthGateProps) {
  const [view, setView] = useState<SignedOutView>('landing');

  const openDemo = () => {
    seedDemo();
    setView('demo');
  };

  const exitDemo = () => {
    clearDemo();
    setView('landing');
  };

  if (view === 'demo') {
    return (
      <>
        <DemoBar onExit={exitDemo} onSignIn={() => setView('signin')} />
        <StorageScopeProvider value={DEMO_SCOPE}>{children}</StorageScopeProvider>
      </>
    );
  }

  if (view === 'signin') return <SignInScreen onBack={() => setView('landing')} />;

  return <LandingPage onTryDemo={openDemo} onSignIn={() => setView('signin')} />;
}

/**
 * Decides whether the dashboard sits behind a Clerk sign-in.
 *
 * Authentication is opt-in (ADR 0003): with no `VITE_CLERK_PUBLISHABLE_KEY` this
 * renders `children` unchanged, keeping the zero-setup, unscoped behaviour the
 * app has always had — there is no signed-out state, so no landing page either.
 * With a key set, a visitor gets the landing page, can try a demo, and the
 * dashboard proper requires a signed-in user whose data is stored under their
 * own namespace.
 *
 * @param props - See {@link AuthGateProps}.
 */
export default function AuthGate({ children }: AuthGateProps) {
  if (!hasClerkKey()) return <>{children}</>;

  return (
    <>
      <SignedOut>
        <SignedOutApp>{children}</SignedOutApp>
      </SignedOut>
      <SignedIn>
        <ScopedApp>{children}</ScopedApp>
      </SignedIn>
    </>
  );
}

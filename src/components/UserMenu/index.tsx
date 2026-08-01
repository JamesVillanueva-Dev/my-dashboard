import { UserButton } from '@clerk/clerk-react';
import { hasClerkKey } from '../../lib/clerkAuth';
import styles from './styles.module.css';

/**
 * The signed-in user's avatar menu (account settings, sign out), rendered in the
 * header next to the theme toggle.
 *
 * Renders nothing when Clerk is not configured (ADR 0003). That guard is what
 * lets the header stay Clerk-agnostic: with no publishable key there is no
 * `<ClerkProvider>` in the tree, and mounting `<UserButton>` would throw.
 */
export default function UserMenu() {
  if (!hasClerkKey()) return null;

  return (
    <div className={styles.container}>
      <UserButton />
    </div>
  );
}

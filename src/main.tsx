/**
 * Browser entry point: mounts the dashboard into `#root`.
 *
 * The only place the global stylesheet is imported and the only place a React
 * root is created. Everything about *what* renders lives in `Dashboard`; this
 * file's one decision is whether Clerk wraps it.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './styles.css'
import Dashboard from './components/Dashboard'
import AuthGate from './components/AuthGate'
import { CLERK_PUBLISHABLE_KEY, hasClerkKey } from './lib/clerkAuth'

/**
 * The app itself, built once and mounted with or without Clerk around it. Held
 * in a variable rather than repeated in both branches below so the two paths
 * cannot drift into rendering different trees.
 */
const app = (
  <AuthGate>
    <Dashboard />
  </AuthGate>
)

// Clerk is opt-in (ADR 0003): with no publishable key the provider is never
// mounted, so the app makes no Clerk requests and behaves exactly as before.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {hasClerkKey() ? (
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY!} afterSignOutUrl="/">
        {app}
      </ClerkProvider>
    ) : (
      app
    )}
  </StrictMode>,
)

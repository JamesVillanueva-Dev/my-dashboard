import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './styles.css'
import Dashboard from './components/Dashboard'
import AuthGate from './components/AuthGate'
import { CLERK_PUBLISHABLE_KEY, hasClerkKey } from './lib/clerkAuth'

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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserMenu from './index';

const state = vi.hoisted(() => ({ configured: true }));

vi.mock('../../lib/clerkAuth', () => ({
  hasClerkKey: () => state.configured,
  CLERK_PUBLISHABLE_KEY: 'pk_test_stub',
}));

// The real UserButton requires a surrounding <ClerkProvider> and network access.
vi.mock('@clerk/clerk-react', () => ({
  UserButton: () => <button>Account</button>,
}));

describe('UserMenu', () => {
  beforeEach(() => {
    state.configured = true;
  });

  it('renders the account button when Clerk is configured', () => {
    render(<UserMenu />);
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('renders nothing when Clerk is not configured', () => {
    state.configured = false;
    const { container } = render(<UserMenu />);
    expect(container).toBeEmptyDOMElement();
  });
});

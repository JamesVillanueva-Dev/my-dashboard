import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserMenu from './index';

/** Whether a Clerk publishable key is configured for this test. */
const clerk = vi.hoisted(() => ({ configured: true }));

vi.mock('../../lib/clerkAuth', () => ({
  hasClerkKey: () => clerk.configured,
  CLERK_PUBLISHABLE_KEY: 'pk_test_stub',
}));

// The real UserButton requires a surrounding <ClerkProvider> and network access.
vi.mock('@clerk/clerk-react', () => ({
  UserButton: () => <button>Account</button>,
}));

beforeEach(() => {
  clerk.configured = true;
});

describe('UserMenu', () => {
  it('renders the account button when Clerk is configured', () => {
    render(<UserMenu />);

    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('renders nothing when Clerk is not configured', () => {
    clerk.configured = false;

    const { container } = render(<UserMenu />);

    expect(container).toBeEmptyDOMElement();
  });
});

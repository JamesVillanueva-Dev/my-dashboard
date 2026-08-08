import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * Imports the module with the given publishable key in the environment.
 *
 * The key is read once, at module load, so each case re-imports the module with
 * its own environment rather than mutating a value already captured.
 */
async function importClerkAuthWithKey(publishableKey: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', publishableKey);
  return import('./clerkAuth');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasClerkKey', () => {
  it('is false when the key is empty', async () => {
    // The zero-setup path: the dashboard runs without sign-in configured.
    const { hasClerkKey } = await importClerkAuthWithKey('');

    expect(hasClerkKey()).toBe(false);
  });

  it('is false when the variable is unset', async () => {
    const { hasClerkKey } = await importClerkAuthWithKey(undefined);

    expect(hasClerkKey()).toBe(false);
  });

  it('is true once a publishable key is set', async () => {
    const { hasClerkKey } = await importClerkAuthWithKey('pk_test_abc123');

    expect(hasClerkKey()).toBe(true);
  });
});

describe('CLERK_PUBLISHABLE_KEY', () => {
  it('exposes the configured key for the Clerk provider to use', async () => {
    const { CLERK_PUBLISHABLE_KEY } = await importClerkAuthWithKey('pk_test_abc123');

    expect(CLERK_PUBLISHABLE_KEY).toBe('pk_test_abc123');
  });
});

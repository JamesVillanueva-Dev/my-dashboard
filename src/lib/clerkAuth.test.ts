import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The key is read once, at module load, so each case re-imports the module with
 * its own environment rather than mutating a value already captured.
 */
async function loadWith(key: string) {
  vi.resetModules();
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', key);
  return import('./clerkAuth');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasClerkKey', () => {
  it('is off when no key is configured — the zero-setup path', async () => {
    const { hasClerkKey } = await loadWith('');

    expect(hasClerkKey()).toBe(false);
  });

  it('is on once a publishable key is set', async () => {
    const { hasClerkKey, CLERK_PUBLISHABLE_KEY } = await loadWith('pk_test_abc123');

    expect(hasClerkKey()).toBe(true);
    expect(CLERK_PUBLISHABLE_KEY).toBe('pk_test_abc123');
  });

  it('treats an unset variable as off', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', undefined);
    const { hasClerkKey } = await import('./clerkAuth');

    expect(hasClerkKey()).toBe(false);
  });
});

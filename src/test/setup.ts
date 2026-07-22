import '@testing-library/jest-dom/vitest';
import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests (RTL auto-cleanup only runs with globals).
afterEach(cleanup);

// jsdom doesn't implement matchMedia — stub it (reports "not dark" by default).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// Tests run offline: default fetch rejects so network widgets hit their handled
// error state. Individual tests override this with vi.stubGlobal when needed.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('network disabled in tests'))),
  );
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAura } from './useAura';

/** The global stub from `src/test/setup.ts`, restored after each test. */
const realMatchMedia = window.matchMedia;

/** Listeners registered on the pointer-capability query. */
let listeners: ((e: MediaQueryListEvent) => void)[] = [];

/** Installs a `matchMedia` reporting whether this device has a mouse. */
function stubPointer(fine: boolean) {
  listeners = [];
  window.matchMedia = ((query: string) => ({
    matches: fine && query.includes('pointer: fine'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners = listeners.filter((l) => l !== fn);
    },
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** Reports a mouse being plugged in or unplugged, with no reload. */
function changePointerTo(fine: boolean) {
  act(() => {
    for (const fn of [...listeners]) fn({ matches: fine } as MediaQueryListEvent);
  });
}

/**
 * Dispatches a pointer move. Built by hand rather than through `fireEvent`
 * because jsdom has no `PointerEvent`, and `pointerType` is what this hook
 * filters on.
 */
function movePointer(x: number, y: number, pointerType = 'mouse') {
  const event = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  window.dispatchEvent(event);
}

const root = () => document.documentElement;
/** The gradient centre currently written to the root, if any. */
const centre = () => [
  root().style.getPropertyValue('--aura-x'),
  root().style.getPropertyValue('--aura-y'),
];

/** Mounts the hook with the effect already switched on. */
function setupOn() {
  localStorage.setItem('aura.follow', JSON.stringify(true));
  return renderHook(() => useAura());
}

beforeEach(() => stubPointer(true));

afterEach(() => {
  window.matchMedia = realMatchMedia;
  root().removeAttribute('data-aura');
  root().style.removeProperty('--aura-x');
  root().style.removeProperty('--aura-y');
});

describe('useAura', () => {
  describe('support', () => {
    it('is available on a device with a mouse', () => {
      const { result } = renderHook(() => useAura());

      expect(result.current.supported).toBe(true);
    });

    it('is unavailable where there is no pointer to follow', () => {
      stubPointer(false);

      const { result } = renderHook(() => useAura());

      expect(result.current.supported).toBe(false);
    });

    it('picks up a mouse plugged in later', () => {
      stubPointer(false);
      const { result } = renderHook(() => useAura());

      changePointerTo(true);

      expect(result.current.supported).toBe(true);
    });

    it('stops listening once unmounted', () => {
      const { unmount } = renderHook(() => useAura());
      expect(listeners).toHaveLength(1);

      unmount();

      expect(listeners).toHaveLength(0);
    });

    it('copes with a browser that cannot report pointer capabilities', () => {
      (window as { matchMedia?: unknown }).matchMedia = undefined;

      const { result } = renderHook(() => useAura());

      expect(result.current.supported).toBe(false);
    });
  });

  describe('the setting', () => {
    it('is off until the user turns it on', () => {
      const { result } = renderHook(() => useAura());

      expect(result.current.enabled).toBe(false);
    });

    it('reads a choice stored by a previous visit', () => {
      const { result } = setupOn();

      expect(result.current.enabled).toBe(true);
    });

    it('persists a change', () => {
      const { result } = renderHook(() => useAura());

      act(() => result.current.setEnabled(true));

      expect(result.current.enabled).toBe(true);
      expect(JSON.parse(localStorage.getItem('aura.follow')!)).toBe(true);
    });

    it('survives a corrupt stored value', () => {
      localStorage.setItem('aura.follow', '{not json');

      const { result } = renderHook(() => useAura());

      expect(result.current.enabled).toBe(false);
    });
  });

  describe('while off', () => {
    it('leaves the background where the stylesheet put it', () => {
      renderHook(() => useAura());

      movePointer(400, 300);

      expect(root()).not.toHaveAttribute('data-aura');
      expect(centre()).toEqual(['', '']);
    });

    it('binds no pointer listener at all', () => {
      const add = vi.spyOn(window, 'addEventListener');

      renderHook(() => useAura());

      expect(add).not.toHaveBeenCalledWith('pointermove', expect.anything(), expect.anything());
    });
  });

  describe('while on', () => {
    it('marks the root so the stylesheet pins that layer to the viewport', () => {
      setupOn();

      expect(root()).toHaveAttribute('data-aura', 'pointer');
    });

    it('re-centres the gradient on the cursor', async () => {
      setupOn();

      movePointer(420, 260);

      await waitFor(() => expect(centre()).toEqual(['420px', '260px']));
    });

    it('keeps up as the cursor moves on', async () => {
      setupOn();

      movePointer(100, 100);
      await waitFor(() => expect(centre()).toEqual(['100px', '100px']));

      movePointer(900, 640);
      await waitFor(() => expect(centre()).toEqual(['900px', '640px']));
    });

    it('writes once per frame, however many moves arrive', async () => {
      const set = vi.spyOn(root().style, 'setProperty');
      setupOn();

      for (let x = 0; x < 20; x++) movePointer(x, x);

      await waitFor(() => expect(centre()).toEqual(['19px', '19px']));
      // Both axes, from the single coalesced write — not 20 of them.
      expect(set.mock.calls.filter(([p]) => p.startsWith('--aura'))).toHaveLength(2);
    });

    it('ignores a finger, which cannot steer anything it is not touching', async () => {
      setupOn();

      movePointer(300, 300, 'touch');
      movePointer(50, 50, 'pen');

      await new Promise((r) => requestAnimationFrame(r));
      expect(centre()).toEqual(['', '']);
    });
  });

  describe('turning it back off', () => {
    it('hands the corner position back to the stylesheet', async () => {
      const { result } = setupOn();
      movePointer(420, 260);
      await waitFor(() => expect(centre()).toEqual(['420px', '260px']));

      act(() => result.current.setEnabled(false));

      expect(root()).not.toHaveAttribute('data-aura');
      expect(centre()).toEqual(['', '']);
    });

    it('stops following', async () => {
      const { result } = setupOn();

      act(() => result.current.setEnabled(false));
      movePointer(700, 500);

      await new Promise((r) => requestAnimationFrame(r));
      expect(centre()).toEqual(['', '']);
    });

    it('gives up when the mouse is unplugged, without forgetting the choice', () => {
      const { result } = setupOn();
      expect(root()).toHaveAttribute('data-aura', 'pointer');

      changePointerTo(false);

      expect(root()).not.toHaveAttribute('data-aura');
      expect(result.current.enabled).toBe(true);
    });

    it('cleans up on unmount, so the aura does not outlive the dashboard', async () => {
      const { unmount } = setupOn();
      movePointer(420, 260);
      await waitFor(() => expect(centre()).toEqual(['420px', '260px']));

      unmount();

      expect(root()).not.toHaveAttribute('data-aura');
      expect(centre()).toEqual(['', '']);
    });
  });
});

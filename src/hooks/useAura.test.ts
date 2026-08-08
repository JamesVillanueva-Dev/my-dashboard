import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAura } from './useAura';

/** What the stubbed device reports for its pointer. */
type Pointer = 'mouse' | 'touch';

/** The global stub from `src/test/setup.ts`, restored after each test. */
const realMatchMedia = window.matchMedia;

/** Listeners registered on the pointer-capability query. */
let pointerListeners: ((event: MediaQueryListEvent) => void)[] = [];

/** Installs a `matchMedia` reporting the given pointer capability. */
function stubPointer(pointer: Pointer) {
  pointerListeners = [];
  window.matchMedia = ((query: string) => ({
    matches: pointer === 'mouse' && query.includes('pointer: fine'),
    media: query,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      pointerListeners.push(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      pointerListeners = pointerListeners.filter((each) => each !== listener);
    },
  })) as unknown as typeof window.matchMedia;
}

/** Reports a mouse being plugged in or unplugged, with no reload. */
function switchPointerTo(pointer: Pointer) {
  act(() => {
    for (const listener of [...pointerListeners]) {
      listener({ matches: pointer === 'mouse' } as MediaQueryListEvent);
    }
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

/** No centre written at all — the corner position the stylesheet owns. */
const NO_CENTRE = ['', ''];

/** Mounts the hook with the effect already switched on. */
function renderWithAuraOn() {
  localStorage.setItem('aura.follow', JSON.stringify(true));
  return renderHook(() => useAura());
}

/** Waits for the frame that writes the centre. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

beforeEach(() => stubPointer('mouse'));

afterEach(() => {
  window.matchMedia = realMatchMedia;
  root().removeAttribute('data-aura');
  root().style.removeProperty('--aura-x');
  root().style.removeProperty('--aura-y');
});

describe('useAura support', () => {
  it('is available on a device with a mouse', () => {
    const { result } = renderHook(() => useAura());

    expect(result.current.supported).toBe(true);
  });

  it('is unavailable where there is no pointer to follow', () => {
    stubPointer('touch');

    const { result } = renderHook(() => useAura());

    expect(result.current.supported).toBe(false);
  });

  it('picks up a mouse plugged in later', () => {
    stubPointer('touch');
    const { result } = renderHook(() => useAura());

    switchPointerTo('mouse');

    expect(result.current.supported).toBe(true);
  });

  it('stops listening once unmounted', () => {
    const { unmount } = renderHook(() => useAura());
    expect(pointerListeners).toHaveLength(1);

    unmount();

    expect(pointerListeners).toHaveLength(0);
  });

  it('is unavailable where the browser cannot report pointer capabilities', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;

    const { result } = renderHook(() => useAura());

    expect(result.current.supported).toBe(false);
  });
});

describe('the aura setting', () => {
  it('is off until the user turns it on', () => {
    const { result } = renderHook(() => useAura());

    expect(result.current.enabled).toBe(false);
  });

  it('reads a choice stored by a previous visit', () => {
    const { result } = renderWithAuraOn();

    expect(result.current.enabled).toBe(true);
  });

  it('persists a change', () => {
    const { result } = renderHook(() => useAura());

    act(() => result.current.setEnabled(true));

    expect(result.current.enabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('aura.follow')!)).toBe(true);
  });

  it('reads a corrupt stored value as off', () => {
    localStorage.setItem('aura.follow', '{not json');

    const { result } = renderHook(() => useAura());

    expect(result.current.enabled).toBe(false);
  });
});

describe('useAura while off', () => {
  it('leaves the background where the stylesheet put it', () => {
    renderHook(() => useAura());

    movePointer(400, 300);

    expect(root()).not.toHaveAttribute('data-aura');
    expect(centre()).toEqual(NO_CENTRE);
  });

  it('binds no pointer listener at all', () => {
    const addListener = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAura());

    expect(addListener).not.toHaveBeenCalledWith(
      'pointermove',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('useAura while on', () => {
  it('marks the root so the stylesheet pins that layer to the viewport', () => {
    renderWithAuraOn();

    expect(root()).toHaveAttribute('data-aura', 'pointer');
  });

  it('re-centres the gradient on the cursor', async () => {
    renderWithAuraOn();

    movePointer(420, 260);

    await waitFor(() => expect(centre()).toEqual(['420px', '260px']));
  });

  it('keeps up as the cursor moves on', async () => {
    renderWithAuraOn();

    movePointer(100, 100);
    await waitFor(() => expect(centre()).toEqual(['100px', '100px']));

    movePointer(900, 640);
    await waitFor(() => expect(centre()).toEqual(['900px', '640px']));
  });

  it('writes once per frame, however many moves arrive', async () => {
    const setProperty = vi.spyOn(root().style, 'setProperty');
    renderWithAuraOn();

    for (let x = 0; x < 20; x++) movePointer(x, x);

    await waitFor(() => expect(centre()).toEqual(['19px', '19px']));
    // Both axes, from the single coalesced write — not 20 of them.
    const auraWrites = setProperty.mock.calls.filter(([property]) => property.startsWith('--aura'));
    expect(auraWrites).toHaveLength(2);
  });

  it('ignores a finger, which cannot steer anything it is not touching', async () => {
    renderWithAuraOn();

    movePointer(300, 300, 'touch');
    movePointer(50, 50, 'pen');

    await nextFrame();
    expect(centre()).toEqual(NO_CENTRE);
  });
});

describe('turning the aura back off', () => {
  it('hands the corner position back to the stylesheet', async () => {
    const { result } = renderWithAuraOn();
    movePointer(420, 260);
    await waitFor(() => expect(centre()).toEqual(['420px', '260px']));

    act(() => result.current.setEnabled(false));

    expect(root()).not.toHaveAttribute('data-aura');
    expect(centre()).toEqual(NO_CENTRE);
  });

  it('stops following the cursor', async () => {
    const { result } = renderWithAuraOn();

    act(() => result.current.setEnabled(false));
    movePointer(700, 500);

    await nextFrame();
    expect(centre()).toEqual(NO_CENTRE);
  });

  it('gives up when the mouse is unplugged, without forgetting the choice', () => {
    const { result } = renderWithAuraOn();
    expect(root()).toHaveAttribute('data-aura', 'pointer');

    switchPointerTo('touch');

    expect(root()).not.toHaveAttribute('data-aura');
    expect(result.current.enabled).toBe(true);
  });

  it('cleans up on unmount, so the aura does not outlive the dashboard', async () => {
    const { unmount } = renderWithAuraOn();
    movePointer(420, 260);
    await waitFor(() => expect(centre()).toEqual(['420px', '260px']));

    unmount();

    expect(root()).not.toHaveAttribute('data-aura');
    expect(centre()).toEqual(NO_CENTRE);
  });
});

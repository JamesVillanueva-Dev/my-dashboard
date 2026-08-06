import { describe, it, expect, beforeEach } from 'vitest';
import { DEMO_SCOPE, clearDemo, demoData, demoTasks, isDemoSeeded, seedDemo } from './demo';
import type { Reminder } from './gcalSync';

/** A fixed clock, so the sample day is the same every run. */
const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

beforeEach(() => localStorage.clear());

describe('demoTasks', () => {
  const tasks = demoTasks(NOW);

  it('builds its dates around the day it is asked for, not a fixed one', () => {
    // A demo showing last spring's schedule reads as abandoned.
    const dated = tasks.filter((t): t is Reminder & { due: string } => t.due !== '');
    for (const task of dated) {
      expect(new Date(task.due).getFullYear()).toBe(new Date(NOW).getFullYear());
      expect(new Date(task.due).getMonth()).toBe(new Date(NOW).getMonth());
    }
  });

  it('covers the states that make the dashboard worth looking at', () => {
    const due = (t: Reminder) => (t.due ? new Date(t.due).getTime() : null);

    // Something overdue, so the stat strip has a reason to colour.
    expect(tasks.some((t) => !t.done && (due(t) ?? Infinity) < NOW)).toBe(true);
    // Something soon, so "next up" has a countdown to run.
    expect(tasks.some((t) => !t.done && (due(t) ?? 0) > NOW)).toBe(true);
    // Something undated, which the agenda has a separate case for.
    expect(tasks.some((t) => t.due === '')).toBe(true);
    // Something already done, so the list is not uniformly open.
    expect(tasks.some((t) => t.done)).toBe(true);
  });

  it('gives every task a distinct id', () => {
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });
});

describe('demoData', () => {
  it('stores values the way useLocalStorage would read them back', () => {
    // Every value is JSON, because that is what the hook parses.
    for (const value of Object.values(demoData(NOW))) {
      expect(() => JSON.parse(value)).not.toThrow();
    }
  });

  it('sets the focus for today, so it is not already expired', () => {
    const focus = JSON.parse(demoData(NOW).focus) as { date: string; text: string };
    const d = new Date(NOW);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(focus.date).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    expect(focus.text).not.toBe('');
  });

  it('lays out a dashboard with something in every panel it enables', () => {
    const data = demoData(NOW);
    const layout = JSON.parse(data.layout) as string[];
    expect(layout).toContain('reminders');
    expect(layout).toContain('notes');
    expect(JSON.parse(data['notes.text'])).not.toBe('');
  });
});

describe('seedDemo', () => {
  it('writes every key under the demo scope and nowhere else', () => {
    seedDemo(NOW);

    const keys = Object.keys(localStorage);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith(`${DEMO_SCOPE}:`))).toBe(true);
  });

  it('leaves alone whatever the visitor already changed', () => {
    seedDemo(NOW);
    localStorage.setItem(`${DEMO_SCOPE}:notes.text`, JSON.stringify('my own note'));

    seedDemo(NOW);

    // A reload should find your arrangement, not a reset one.
    expect(localStorage.getItem(`${DEMO_SCOPE}:notes.text`)).toBe(JSON.stringify('my own note'));
  });

  it('cannot touch a real account’s namespace', () => {
    localStorage.setItem('user_a:notes.text', JSON.stringify('real note'));
    localStorage.setItem('notes.text', JSON.stringify('unscoped note'));

    seedDemo(NOW);

    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify('real note'));
    expect(localStorage.getItem('notes.text')).toBe(JSON.stringify('unscoped note'));
  });
});

describe('isDemoSeeded', () => {
  it('is false before seeding and true after', () => {
    expect(isDemoSeeded()).toBe(false);
    seedDemo(NOW);
    expect(isDemoSeeded()).toBe(true);
  });
});

describe('clearDemo', () => {
  it('removes the demo entirely, including anything the visitor added', () => {
    seedDemo(NOW);
    localStorage.setItem(`${DEMO_SCOPE}:notes.text`, JSON.stringify('my own note'));

    clearDemo();

    expect(isDemoSeeded()).toBe(false);
    expect(Object.keys(localStorage).some((k) => k.startsWith(`${DEMO_SCOPE}:`))).toBe(false);
  });

  it('leaves every other namespace alone', () => {
    localStorage.setItem('user_a:notes.text', JSON.stringify('real note'));
    seedDemo(NOW);

    clearDemo();

    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify('real note'));
  });
});

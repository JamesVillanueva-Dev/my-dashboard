import { describe, it, expect, beforeEach } from 'vitest';
import { DEMO_SCOPE, clearDemo, demoData, demoTasks, isDemoSeeded, seedDemo } from './demo';
import type { Reminder } from './gcalSync';

/** A fixed clock, so the sample day is the same every run. */
const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

/** A localStorage key inside the demo's namespace. */
const demoKey = (key: string) => `${DEMO_SCOPE}:${key}`;

/** Every localStorage key the demo owns. */
const seededKeys = () => Object.keys(localStorage).filter((key) => key.startsWith(`${DEMO_SCOPE}:`));

/** A task's due date as epoch ms, or null when it has none. */
const dueAt = (task: Reminder) => (task.due ? new Date(task.due).getTime() : null);

beforeEach(() => localStorage.clear());

describe('demoTasks', () => {
  const tasks = demoTasks(NOW);

  it('dates the sample tasks in the month it is asked for', () => {
    const datedTasks = tasks.filter((task) => task.due !== '');

    // A demo showing last spring's schedule reads as abandoned.
    for (const task of datedTasks) {
      expect(new Date(task.due).getFullYear()).toBe(new Date(NOW).getFullYear());
      expect(new Date(task.due).getMonth()).toBe(new Date(NOW).getMonth());
    }
  });

  it('includes an overdue task, so the stat strip has a reason to colour', () => {
    expect(tasks.some((task) => !task.done && (dueAt(task) ?? Infinity) < NOW)).toBe(true);
  });

  it('includes an upcoming task, so "next up" has a countdown to run', () => {
    expect(tasks.some((task) => !task.done && (dueAt(task) ?? 0) > NOW)).toBe(true);
  });

  it('includes an undated task, which the agenda has a separate case for', () => {
    expect(tasks.some((task) => task.due === '')).toBe(true);
  });

  it('includes a finished task, so the list is not uniformly open', () => {
    expect(tasks.some((task) => task.done)).toBe(true);
  });

  it('gives every task a distinct id', () => {
    const ids = tasks.map((task) => task.id);

    expect(new Set(ids).size).toBe(tasks.length);
  });
});

describe('demoData', () => {
  it('stores every value as JSON, the way useLocalStorage reads it back', () => {
    for (const value of Object.values(demoData(NOW))) {
      expect(() => JSON.parse(value)).not.toThrow();
    }
  });

  it('dates the focus to today, so it is not already expired', () => {
    const focus = JSON.parse(demoData(NOW).focus) as { date: string; text: string };

    const today = new Date(NOW);
    const pad = (part: number) => String(part).padStart(2, '0');
    expect(focus.date).toBe(
      `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    );
  });

  it('gives the focus something to say', () => {
    const focus = JSON.parse(demoData(NOW).focus) as { date: string; text: string };

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
  it('writes every key under the demo scope', () => {
    seedDemo(NOW);

    expect(seededKeys().length).toBeGreaterThan(0);
    expect(seededKeys()).toEqual(Object.keys(localStorage));
  });

  it('leaves alone whatever the visitor already changed', () => {
    seedDemo(NOW);
    localStorage.setItem(demoKey('notes.text'), JSON.stringify('my own note'));

    seedDemo(NOW);

    // A reload should find your arrangement, not a reset one.
    expect(localStorage.getItem(demoKey('notes.text'))).toBe(JSON.stringify('my own note'));
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
  it('is false before seeding', () => {
    expect(isDemoSeeded()).toBe(false);
  });

  it('is true after seeding', () => {
    seedDemo(NOW);

    expect(isDemoSeeded()).toBe(true);
  });
});

describe('clearDemo', () => {
  it('removes the demo entirely, including anything the visitor added', () => {
    seedDemo(NOW);
    localStorage.setItem(demoKey('notes.text'), JSON.stringify('my own note'));

    clearDemo();

    expect(isDemoSeeded()).toBe(false);
    expect(seededKeys()).toHaveLength(0);
  });

  it('leaves every other namespace alone', () => {
    localStorage.setItem('user_a:notes.text', JSON.stringify('real note'));
    seedDemo(NOW);

    clearDemo();

    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify('real note'));
  });
});

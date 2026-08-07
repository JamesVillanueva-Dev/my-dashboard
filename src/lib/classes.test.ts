import { describe, it, expect } from 'vitest';
import {
  NAME_MAX,
  addCourse,
  addNote,
  editNote,
  isBlank,
  moveNote,
  newId,
  normalizeCourses,
  removeCourse,
  removeNote,
  renameCourse,
  selectedCourse,
  type CourseEntry,
} from './classes';

/** A course with `notes` titled by their id, for readable assertions. */
const course = (id: string, ...labels: string[]): CourseEntry => ({
  id,
  name: `Class ${id}`,
  notes: labels.map((label) => ({ id: `${id}-${label}`, label, body: `about ${label}` })),
});

/** The labels of one course's notes, in order. */
const labels = (courses: CourseEntry[], id: string) =>
  courses.find((c) => c.id === id)!.notes.map((n) => n.label);

describe('newId', () => {
  it('does not collide within a single millisecond', () => {
    // Adding notes by holding the button lands several in the same tick, and
    // duplicate ids would make React edit the wrong one.
    const ids = Array.from({ length: 500 }, newId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeCourses', () => {
  it('reads back what was stored', () => {
    const stored = [course('a', 'Midterm')];
    expect(normalizeCourses(stored)).toEqual(stored);
  });

  it('treats anything that is not a list as no classes at all', () => {
    for (const junk of [null, undefined, 42, 'courses', { a: 1 }]) {
      expect(normalizeCourses(junk)).toEqual([]);
    }
  });

  it('drops entries that could not be rendered, keeping the rest', () => {
    const out = normalizeCourses([course('a', 'Final'), null, { notes: [] }, 7, course('b')]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('gives an entry an id when storage lost it, rather than dropping the notes', () => {
    const [only] = normalizeCourses([{ name: 'CSE 101', notes: [{ label: 'Final', body: '9am' }] }]);
    expect(only.id).toBeTruthy();
    expect(only.notes[0].id).toBeTruthy();
    expect(only.notes[0].label).toBe('Final');
  });

  it('tolerates a note with only one of its two halves written', () => {
    const [only] = normalizeCourses([
      { id: 'a', name: 'A', notes: [{ id: '1', body: 'no title yet' }, { id: '2', label: 'no body yet' }] },
    ]);
    expect(only.notes).toEqual([
      { id: '1', label: '', body: 'no title yet' },
      { id: '2', label: 'no body yet', body: '' },
    ]);
  });

  it('caps a name that would otherwise run off the tab row', () => {
    const [only] = normalizeCourses([{ id: 'a', name: 'x'.repeat(200), notes: [] }]);
    expect(only.name).toHaveLength(NAME_MAX);
  });
});

describe('addCourse', () => {
  it('adds a course under the name as typed, trimmed', () => {
    const out = addCourse([], '  CSE 101  ');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('CSE 101');
    expect(out[0].notes).toEqual([]);
  });

  it('refuses a blank name by handing back exactly what it was given', () => {
    // Identity is the signal the caller uses to know nothing happened — an
    // unnamed class is a tab nobody could identify.
    const courses = [course('a')];
    expect(addCourse(courses, '   ')).toBe(courses);
    expect(addCourse(courses, '')).toBe(courses);
  });
});

describe('removeCourse / renameCourse', () => {
  it('removes a course and everything under it', () => {
    expect(removeCourse([course('a'), course('b')], 'a').map((c) => c.id)).toEqual(['b']);
  });

  it('renames one course and leaves its notes alone', () => {
    const out = renameCourse([course('a', 'Final'), course('b')], 'a', 'Organic Chem');
    expect(out[0].name).toBe('Organic Chem');
    expect(out[0].notes).toHaveLength(1);
    expect(out[1].name).toBe('Class b');
  });

  it('ignores a blank rename, so a tab cannot lose its label', () => {
    expect(renameCourse([course('a')], 'a', '  ')[0].name).toBe('Class a');
  });
});

describe('addNote / editNote / removeNote', () => {
  it('adds an empty note for the user to name and fill', () => {
    const out = addNote([course('a', 'Final')], 'a');
    expect(out[0].notes).toHaveLength(2);
    expect(out[0].notes[1]).toMatchObject({ label: '', body: '' });
  });

  it('leaves other courses untouched when adding', () => {
    const out = addNote([course('a'), course('b', 'Rubric')], 'a');
    expect(out[1].notes).toHaveLength(1);
  });

  it('patches only the field given, on only the note named', () => {
    const out = editNote([course('a', 'Final', 'Rubric')], 'a', 'a-Final', { body: '9am, Peterson' });
    expect(out[0].notes[0]).toEqual({ id: 'a-Final', label: 'Final', body: '9am, Peterson' });
    expect(out[0].notes[1].body).toBe('about Rubric');
  });

  it('removes one note and nothing else', () => {
    const out = removeNote([course('a', 'Final', 'Rubric')], 'a', 'a-Final');
    expect(labels(out, 'a')).toEqual(['Rubric']);
  });
});

describe('moveNote', () => {
  it('moves a note up and down its own course', () => {
    const start = [course('a', 'one', 'two', 'three')];
    expect(labels(moveNote(start, 'a', 'a-three', -1), 'a')).toEqual(['one', 'three', 'two']);
    expect(labels(moveNote(start, 'a', 'a-one', 1), 'a')).toEqual(['two', 'one', 'three']);
  });

  it('does nothing at either end, rather than wrapping around', () => {
    const start = [course('a', 'one', 'two')];
    expect(labels(moveNote(start, 'a', 'a-one', -1), 'a')).toEqual(['one', 'two']);
    expect(labels(moveNote(start, 'a', 'a-two', 1), 'a')).toEqual(['one', 'two']);
  });

  it('ignores a note that is not in the course named', () => {
    const start = [course('a', 'one'), course('b', 'other')];
    expect(moveNote(start, 'a', 'b-other', 1)).toEqual(start);
  });
});

describe('isBlank', () => {
  it('is true only when both halves are empty or whitespace', () => {
    expect(isBlank({ id: '1', label: '', body: '' })).toBe(true);
    expect(isBlank({ id: '1', label: '  ', body: '\n' })).toBe(true);
    expect(isBlank({ id: '1', label: 'Final', body: '' })).toBe(false);
    expect(isBlank({ id: '1', label: '', body: 'note to self' })).toBe(false);
  });
});

describe('selectedCourse', () => {
  it('finds the course a saved selection names', () => {
    expect(selectedCourse([course('a'), course('b')], 'b')?.id).toBe('b');
  });

  it('falls back to the first when the saved one was removed', () => {
    // Otherwise the panel would show nothing, with no way back to a class that
    // does exist.
    expect(selectedCourse([course('a')], 'gone')?.id).toBe('a');
  });

  it('is null when there are no classes at all', () => {
    expect(selectedCourse([], 'a')).toBeNull();
  });
});

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

/** A course whose notes are titled by their id, for readable assertions. */
const course = (id: string, ...noteLabels: string[]): CourseEntry => ({
  id,
  name: `Class ${id}`,
  notes: noteLabels.map((label) => ({ id: `${id}-${label}`, label, body: `about ${label}` })),
});

/** The labels of one course's notes, in order. */
const labelsOf = (courses: CourseEntry[], courseId: string) =>
  courses.find((each) => each.id === courseId)!.notes.map((note) => note.label);

/** The ids of the courses, in order. */
const idsOf = (courses: CourseEntry[]) => courses.map((each) => each.id);

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
    for (const notAList of [null, undefined, 42, 'courses', { a: 1 }]) {
      expect(normalizeCourses(notAList)).toEqual([]);
    }
  });

  it('drops entries that could not be rendered, keeping the rest', () => {
    const normalized = normalizeCourses([
      course('a', 'Final'),
      null,
      { notes: [] },
      7,
      course('b'),
    ]);

    expect(idsOf(normalized)).toEqual(['a', 'b']);
  });

  it('gives an entry an id when storage lost it, rather than dropping the notes', () => {
    const [onlyCourse] = normalizeCourses([
      { name: 'CSE 101', notes: [{ label: 'Final', body: '9am' }] },
    ]);

    expect(onlyCourse.id).toBeTruthy();
    expect(onlyCourse.notes[0].id).toBeTruthy();
    expect(onlyCourse.notes[0].label).toBe('Final');
  });

  it('fills in the missing half of a partly written note', () => {
    const [onlyCourse] = normalizeCourses([
      {
        id: 'a',
        name: 'A',
        notes: [
          { id: '1', body: 'no title yet' },
          { id: '2', label: 'no body yet' },
        ],
      },
    ]);

    expect(onlyCourse.notes).toEqual([
      { id: '1', label: '', body: 'no title yet' },
      { id: '2', label: 'no body yet', body: '' },
    ]);
  });

  it('caps a name that would otherwise run off the tab row', () => {
    const [onlyCourse] = normalizeCourses([{ id: 'a', name: 'x'.repeat(200), notes: [] }]);

    expect(onlyCourse.name).toHaveLength(NAME_MAX);
  });
});

describe('addCourse', () => {
  it('adds a course under the name as typed, trimmed', () => {
    const courses = addCourse([], '  CSE 101  ');

    expect(courses).toHaveLength(1);
    expect(courses[0].name).toBe('CSE 101');
    expect(courses[0].notes).toEqual([]);
  });

  it('returns the same list for a blank name', () => {
    // Identity is the signal the caller uses to know nothing happened — an
    // unnamed class is a tab nobody could identify.
    const courses = [course('a')];

    expect(addCourse(courses, '   ')).toBe(courses);
    expect(addCourse(courses, '')).toBe(courses);
  });
});

describe('removeCourse', () => {
  it('removes a course and everything under it', () => {
    const remaining = removeCourse([course('a'), course('b')], 'a');

    expect(idsOf(remaining)).toEqual(['b']);
  });
});

describe('renameCourse', () => {
  it('renames one course and leaves its notes alone', () => {
    const courses = renameCourse([course('a', 'Final'), course('b')], 'a', 'Organic Chem');

    expect(courses[0].name).toBe('Organic Chem');
    expect(courses[0].notes).toHaveLength(1);
  });

  it('leaves the other courses alone', () => {
    const courses = renameCourse([course('a', 'Final'), course('b')], 'a', 'Organic Chem');

    expect(courses[1].name).toBe('Class b');
  });

  it('ignores a blank rename, so a tab cannot lose its label', () => {
    expect(renameCourse([course('a')], 'a', '  ')[0].name).toBe('Class a');
  });
});

describe('addNote', () => {
  it('adds an empty note for the user to name and fill', () => {
    const courses = addNote([course('a', 'Final')], 'a');

    expect(courses[0].notes).toHaveLength(2);
    expect(courses[0].notes[1]).toMatchObject({ label: '', body: '' });
  });

  it('leaves the other courses untouched', () => {
    const courses = addNote([course('a'), course('b', 'Rubric')], 'a');

    expect(courses[1].notes).toHaveLength(1);
  });
});

describe('editNote', () => {
  it('patches only the field given, on only the note named', () => {
    const courses = editNote([course('a', 'Final', 'Rubric')], 'a', 'a-Final', {
      body: '9am, Peterson',
    });

    expect(courses[0].notes[0]).toEqual({ id: 'a-Final', label: 'Final', body: '9am, Peterson' });
    expect(courses[0].notes[1].body).toBe('about Rubric');
  });
});

describe('removeNote', () => {
  it('removes one note and nothing else', () => {
    const courses = removeNote([course('a', 'Final', 'Rubric')], 'a', 'a-Final');

    expect(labelsOf(courses, 'a')).toEqual(['Rubric']);
  });
});

describe('moveNote', () => {
  it('moves a note up its course', () => {
    const courses = [course('a', 'one', 'two', 'three')];

    expect(labelsOf(moveNote(courses, 'a', 'a-three', -1), 'a')).toEqual(['one', 'three', 'two']);
  });

  it('moves a note down its course', () => {
    const courses = [course('a', 'one', 'two', 'three')];

    expect(labelsOf(moveNote(courses, 'a', 'a-one', 1), 'a')).toEqual(['two', 'one', 'three']);
  });

  it('does nothing at either end, rather than wrapping around', () => {
    const courses = [course('a', 'one', 'two')];

    expect(labelsOf(moveNote(courses, 'a', 'a-one', -1), 'a')).toEqual(['one', 'two']);
    expect(labelsOf(moveNote(courses, 'a', 'a-two', 1), 'a')).toEqual(['one', 'two']);
  });

  it('ignores a note that is not in the course named', () => {
    const courses = [course('a', 'one'), course('b', 'other')];

    expect(moveNote(courses, 'a', 'b-other', 1)).toEqual(courses);
  });
});

describe('isBlank', () => {
  it('is true when both halves are empty or whitespace', () => {
    expect(isBlank({ id: '1', label: '', body: '' })).toBe(true);
    expect(isBlank({ id: '1', label: '  ', body: '\n' })).toBe(true);
  });

  it('is false when either half has something in it', () => {
    expect(isBlank({ id: '1', label: 'Final', body: '' })).toBe(false);
    expect(isBlank({ id: '1', label: '', body: 'note to self' })).toBe(false);
  });
});

describe('selectedCourse', () => {
  it('finds the course a saved selection names', () => {
    expect(selectedCourse([course('a'), course('b')], 'b')?.id).toBe('b');
  });

  it('falls back to the first course when the saved one was removed', () => {
    // Otherwise the panel would show nothing, with no way back to a class that
    // does exist.
    expect(selectedCourse([course('a')], 'gone')?.id).toBe('a');
  });

  it('is null when there are no classes at all', () => {
    expect(selectedCourse([], 'a')).toBeNull();
  });
});

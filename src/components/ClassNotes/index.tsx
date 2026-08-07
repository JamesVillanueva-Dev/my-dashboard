import { useEffect, useRef, useState, type FormEvent } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import {
  NAME_MAX,
  addCourse,
  addNote,
  editNote,
  isBlank,
  moveNote,
  normalizeCourses,
  removeCourse,
  removeNote,
  renameCourse,
  selectedCourse,
  type ClassNote,
  type CourseEntry,
} from '../../lib/classes';
import styles from './styles.module.css';

/** Props for {@link NoteCard}. */
interface NoteCardProps {
  /** The note to show or edit. */
  note: ClassNote;
  /** Whether this note is the one open for editing. */
  editing: boolean;
  /** Whether it can move further up and down the list. */
  canMove: { up: boolean; down: boolean };
  /** Opens this note for editing. */
  onEdit: () => void;
  /** Closes the editor. */
  onDone: () => void;
  /** Writes a change through as it is typed. */
  onChange: (patch: Partial<Pick<ClassNote, 'label' | 'body'>>) => void;
  /** Reorders it within the course. */
  onMove: (delta: number) => void;
  /** Deletes it. */
  onRemove: () => void;
}

/**
 * One note: a label the user chose and whatever they wrote under it.
 *
 * Reads as text and becomes a form on click, the same bargain the daily focus
 * makes — a wall of input boxes is not something anyone wants to look at, and a
 * page of notes you cannot edit is not one anyone wants to keep. Blank lines in
 * the body survive, because a rubric pasted in with its own spacing should look
 * the way it did when it was pasted.
 *
 * @param props - See {@link NoteCardProps}.
 */
function NoteCard({
  note,
  editing,
  canMove,
  onEdit,
  onDone,
  onChange,
  onMove,
  onRemove,
}: NoteCardProps) {
  const labelRef = useRef<HTMLInputElement>(null);

  // A note is created empty and opened at once, so the caret belongs in the
  // label the moment it appears — the first thing to say is what this is.
  useEffect(() => {
    if (editing) labelRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <li className={`${styles.note} ${styles.isEditing}`}>
        <input
          ref={labelRef}
          className={styles.label}
          value={note.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="What is this? e.g. Midterm 2"
          aria-label="Note title"
        />
        <textarea
          className={styles.body}
          value={note.body}
          onChange={(e) => onChange({ body: e.target.value })}
          placeholder="Anything worth remembering — dates, weightings, where it is…"
          aria-label="Note"
          rows={4}
        />
        <div className={styles.noteBar}>
          <button className={styles.done} onClick={onDone}>
            Done
          </button>
          <span />
          <button
            className={styles.iconBtn}
            onClick={() => onMove(-1)}
            disabled={!canMove.up}
            title="Move up"
            aria-label={`Move ${note.label || 'note'} up`}
          >
            <Icon name="chevronUp" />
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => onMove(1)}
            disabled={!canMove.down}
            title="Move down"
            aria-label={`Move ${note.label || 'note'} down`}
          >
            <Icon name="chevronDown" />
          </button>
          <button
            className={styles.remove}
            onClick={onRemove}
            title="Delete this note"
            aria-label={`Delete ${note.label || 'note'}`}
          >
            <Icon name="close" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={styles.note}>
      <button
        className={styles.open}
        onClick={onEdit}
        aria-label={`Edit ${note.label || 'untitled note'}`}
      >
        <span className={styles.label}>{note.label || 'Untitled'}</span>
        {note.body && <span className={styles.body}>{note.body}</span>}
      </button>
    </li>
  );
}

/**
 * A notebook for your classes: one tab per course, and under each, whatever you
 * decide is worth remembering about it.
 *
 * Deliberately unopinionated about *what* you record. There is no exam-date
 * field, no rubric box, no slot for office hours — every note is a title you
 * write and a body you write, so a course with four exams, one with a group
 * project, and one that is really just a reading list all fit the same panel.
 * Fixing the fields in advance would be guessing at how somebody studies, and
 * the guess is wrong often enough to make the panel useless when it is.
 *
 * Everything lives in this browser (`localStorage`, ADR 0001) and syncs to the
 * account like the rest of the dashboard when signed in. The panel is worth
 * opening full screen — a term's worth of notes outgrows a card quickly, and at
 * full size the notes lay out in columns.
 */
export default function ClassNotes() {
  const [stored, setStored] = useLocalStorage<CourseEntry[]>('classes.courses', []);
  const [currentId, setCurrentId] = useLocalStorage<string>('classes.current', '');
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renaming, setRenaming] = useState(false);
  /** Id of the note open for editing, or `''` for none. */
  const [editingId, setEditingId] = useState('');

  const courses = normalizeCourses(stored);
  const course = selectedCourse(courses, currentId);

  /** Applies a change and keeps the panel pointed at a course that exists. */
  const commit = (next: CourseEntry[], selectId?: string) => {
    setStored(next);
    if (selectId !== undefined) setCurrentId(selectId);
  };

  const submitCourse = (e: FormEvent) => {
    e.preventDefault();
    const next = addCourse(courses, draftName);
    // `addCourse` refuses a blank name by returning what it was given.
    if (next === courses) return;
    commit(next, next[next.length - 1].id);
    setDraftName('');
    setAdding(false);
  };

  const dropCourse = (id: string) => {
    const next = removeCourse(courses, id);
    commit(next, id === course?.id ? (next[0]?.id ?? '') : currentId);
    setEditingId('');
  };

  const startNote = () => {
    if (!course) return;
    const next = addNote(courses, course.id);
    const added = next.find((c) => c.id === course.id)?.notes.at(-1);
    setStored(next);
    // Opened by the same click that made it: there is nothing to read yet.
    if (added) setEditingId(added.id);
  };

  /**
   * Closes the editor, dropping the note if nothing was written.
   *
   * Opening a note and thinking better of it should leave no trace. Without
   * this, every abandoned click would leave an "Untitled" card to clean up by
   * hand.
   */
  const finishNote = () => {
    const open = course?.notes.find((note) => note.id === editingId);
    if (course && open && isBlank(open)) setStored(removeNote(courses, course.id, open.id));
    setEditingId('');
  };

  const body = () => {
    if (courses.length === 0) {
      return (
        <div className={styles.empty}>
          <p>No classes yet.</p>
          <p>
            Add one, then keep whatever you like under it — exam times, rubrics, what the
            professor keeps repeating. You name each note yourself.
          </p>
        </div>
      );
    }

    return (
      <>
        <div className={styles.tabs} role="tablist" aria-label="Classes">
          {courses.map((entry) => (
            <span key={entry.id}>
              <button
                className={`${styles.tab}${entry.id === course?.id ? ` ${styles.isActive}` : ''}`}
                role="tab"
                aria-selected={entry.id === course?.id}
                onClick={() => {
                  setCurrentId(entry.id);
                  setEditingId('');
                  setRenaming(false);
                }}
              >
                {entry.name}
              </button>
              <button
                className={styles.drop}
                onClick={() => dropCourse(entry.id)}
                title={`Remove ${entry.name}`}
                aria-label={`Remove ${entry.name}`}
              >
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>

        {course && (
          <div className={styles.course}>
            <div className={styles.courseHead}>
              {renaming ? (
                <input
                  className={styles.rename}
                  autoFocus
                  defaultValue={course.name}
                  maxLength={NAME_MAX}
                  aria-label="Class name"
                  onBlur={(e) => {
                    commit(renameCourse(courses, course.id, e.target.value));
                    setRenaming(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                />
              ) : (
                <button
                  className={styles.name}
                  onClick={() => setRenaming(true)}
                  aria-label={`Rename ${course.name}`}
                >
                  {course.name}
                </button>
              )}
              <button className={styles.add} onClick={startNote}>
                <Icon name="plus" /> Note
              </button>
            </div>

            {course.notes.length === 0 ? (
              <p className={styles.none}>
                Nothing here yet. Add a note and title it whatever suits — “Final”, “Rubric”,
                “Office hours”.
              </p>
            ) : (
              <ul className={styles.notes}>
                {course.notes.map((note, i) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    editing={note.id === editingId}
                    canMove={{ up: i > 0, down: i < course.notes.length - 1 }}
                    onEdit={() => setEditingId(note.id)}
                    onDone={finishNote}
                    onChange={(patch) => setStored(editNote(courses, course.id, note.id, patch))}
                    onMove={(delta) => setStored(moveNote(courses, course.id, note.id, delta))}
                    onRemove={() => {
                      setStored(removeNote(courses, course.id, note.id));
                      setEditingId('');
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <Widget
      title="Classes"
      icon="book"
      className={styles.container}
      // A term's notes outgrow a card fast, and at full size they lay out in
      // columns instead of one long scroll.
      expandable
      action={
        <button
          className={styles.new}
          onClick={() => {
            setAdding((open) => !open);
            setDraftName('');
          }}
          title={adding ? 'Cancel' : 'Add a class'}
          aria-label={adding ? 'Cancel adding a class' : 'Add a class'}
        >
          <Icon name={adding ? 'close' : 'plus'} />
        </button>
      }
    >
      {adding && (
        <form className={styles.form} onSubmit={submitCourse}>
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Class name, e.g. CSE 101"
            maxLength={NAME_MAX}
            aria-label="Class name"
          />
          <button className={styles.save} type="submit">
            Add
          </button>
        </form>
      )}
      {body()}
    </Widget>
  );
}

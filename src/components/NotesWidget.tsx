import { useState, useEffect } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

/**
 * Free-form scratchpad whose contents autosave to localStorage on every
 * keystroke. A brief "saved ✓" indicator appears once typing settles. Intended
 * as a placeholder until Google Docs sync is added.
 */
export default function NotesWidget() {
  const [notes, setNotes] = useLocalStorage<string>('notes.text', '');
  const [saved, setSaved] = useState(true);

  // After the text settles for a moment, show a "saved" flash.
  useEffect(() => {
    if (saved) return;
    const id = setTimeout(() => setSaved(true), 600);
    return () => clearTimeout(id);
  }, [saved, notes]);

  const onChange = (value: string) => {
    setNotes(value);
    setSaved(false);
  };

  return (
    <Widget
      title="Notes"
      action={<span className="muted small">{saved && notes ? 'saved ✓' : ''}</span>}
    >
      <textarea
        className="notes__area"
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Jot anything down — it's saved automatically in this browser."
      />
      <p className="muted small notes__hint">
        Stored locally for now. Google Docs sync can be added later (needs Google sign-in).
      </p>
    </Widget>
  );
}

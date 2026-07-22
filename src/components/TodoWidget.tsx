import { useState } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface Task {
  id: string;
  text: string;
  done: boolean;
}

/**
 * Simple checkable task list persisted to localStorage. New tasks are added to
 * the top; completed tasks sink to the bottom. The header shows the count of
 * remaining (incomplete) tasks.
 */
export default function TodoWidget() {
  const [tasks, setTasks] = useLocalStorage<Task[]>('todos', []);
  const [text, setText] = useState('');

  const add = () => {
    if (!text.trim()) return;
    setTasks([{ id: `${Date.now()}`, text: text.trim(), done: false }, ...tasks]);
    setText('');
  };
  const toggle = (id: string) =>
    setTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTasks(tasks.filter((t) => t.id !== id));

  const remaining = tasks.filter((t) => !t.done).length;
  const sorted = [...tasks].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

  return (
    <Widget
      title="To-do"
      action={<span className="muted small">{remaining} left</span>}
    >
      <div className="reminder__form">
        <input
          type="text"
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add}>
          Add
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="muted">No tasks yet.</p>
      ) : (
        <ul className="list">
          {sorted.map((t) => (
            <li key={t.id} className={t.done ? 'is-done' : ''}>
              <label>
                <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} />
                <span className="list__text">{t.text}</span>
              </label>
              <button className="list__del" onClick={() => remove(t.id)} title="Delete">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

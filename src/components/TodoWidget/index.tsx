import { useState } from 'react';
import Widget from '../Widget';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import styles from './styles.module.css';

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
      className={styles.container}
      action={<span className={styles.count}>{remaining} left</span>}
    >
      <div className={styles.form}>
        <input
          type="text"
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className={styles.add} onClick={add}>
          Add
        </button>
      </div>
      {sorted.length === 0 ? (
        <p>No tasks yet.</p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((t) => (
            <li key={t.id} className={t.done ? styles.isDone : undefined}>
              <label>
                <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} />
                <span>{t.text}</span>
              </label>
              <button onClick={() => remove(t.id)} title="Delete">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

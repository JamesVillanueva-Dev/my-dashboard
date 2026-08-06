import Icon from '../Icon';
import styles from './styles.module.css';

/** Props for {@link DemoBar}. */
interface DemoBarProps {
  /** Leaves the demo, discarding everything it wrote. */
  onExit: () => void;
  /** Reveals the sign-in form. */
  onSignIn: () => void;
}

/**
 * The strip pinned above a demo dashboard.
 *
 * Two jobs, and the first matters more: say plainly that this is a demo, so
 * nobody spends an afternoon furnishing a dashboard that was never going to be
 * kept. The second is to make signing in reachable from inside the demo, at the
 * moment someone has decided they want it.
 *
 * @param props - See {@link DemoBarProps}.
 */
export default function DemoBar({ onExit, onSignIn }: DemoBarProps) {
  return (
    <div className={styles.container} role="region" aria-label="Demo mode">
      <p>
        <Icon name="play" />
        <span>
          <strong>Demo.</strong> Real dashboard, sample data — nothing here is saved to an
          account.
        </span>
      </p>
      <div>
        {/* Just "Sign in", not "sign in to keep it": sign-in is restricted to
            accounts added by hand, so inviting a visitor to save their work
            would be promising something they cannot have. */}
        <button className={styles.signIn} onClick={onSignIn}>
          Sign in
        </button>
        <button className={styles.exit} onClick={onExit}>
          <Icon name="close" />
          Exit demo
        </button>
      </div>
    </div>
  );
}

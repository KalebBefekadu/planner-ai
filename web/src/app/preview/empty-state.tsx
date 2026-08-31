'use client';

import styles from './preview.module.css';

/* One empty state for the whole product. Every surface that can be empty says
   what the space is for and offers the single action that fills it, rather
   than showing a blank canvas (patterns to avoid, 17). */
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondary,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick?: () => void };
  secondary?: { label: string; onClick?: () => void };
}) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyStateIcon} aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action || secondary ? (
        <div className={styles.emptyStateActions}>
          {action ? (
            <button className={styles.primaryButton} type="button" onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
          {secondary ? (
            <button className={styles.quietButton} type="button" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

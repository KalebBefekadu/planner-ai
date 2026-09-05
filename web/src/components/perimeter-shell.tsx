import type { ReactNode } from 'react';

/* The shell for every screen before the workspace: sign in, sign up, password
   reset, and password update. It is the only place the product gets to say
   what it is, so the marketing column carries the three promises rather than a
   logo and empty space. Server component — none of this needs client JS.

   Design follows the /preview reference implementation and
   docs/product/experience.md. */

const promises = [
  {
    title: 'Say it once, keep it forever',
    body: 'Talk through the week. Nothing gets lost and nothing gets summarized away.',
  },
  {
    title: 'Every action ladders up',
    body: 'Today connects to the month, the quarter, the year, and the life you are building.',
  },
  {
    title: 'Nothing changes without a preview',
    body: 'AI proposes exact changes with evidence. You approve, and you can always undo.',
  },
];

export function PerimeterShell({ children }: { children: ReactNode }) {
  return (
    <div className="perimeter">
      <aside className="perimeter-aside">
        <p className="perimeter-brand">
          <span className="perimeter-brand-mark" aria-hidden="true">
            P
          </span>
          Planner AI
        </p>
        <p className="perimeter-tagline">
          Talk through your week. Planner keeps the structure — from this week&rsquo;s actions up to
          the life you&rsquo;re building.
        </p>
        <ul className="perimeter-promises">
          {promises.map((promise) => (
            <li key={promise.title}>
              <strong>{promise.title}</strong>
              <span>{promise.body}</span>
            </li>
          ))}
        </ul>
        <p className="perimeter-foot">
          Your material stays exportable as Markdown. Delete your account and it goes with you.
        </p>
      </aside>
      <main className="perimeter-main">{children}</main>
    </div>
  );
}

export function PerimeterMessage({ message, tone }: { message: string; tone: 'error' | 'info' }) {
  return (
    <p
      className={
        tone === 'error' ? 'perimeter-message perimeter-message-error' : 'perimeter-message'
      }
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}

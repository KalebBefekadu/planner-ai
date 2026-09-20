import type { ReactNode } from 'react';

/* The shell for every screen before the workspace: sign in, sign up, password
   reset, and password update. It gives the product one concise introduction
   without competing with the task the person came here to complete. Server
   component — none of this needs client JS.

   Design follows the /preview reference implementation and
   docs/product/experience.md. */

const promises = [
  {
    title: 'Capture without losing context',
    body: 'Keep the original thought alongside the plan it becomes.',
  },
  {
    title: 'Turn direction into action',
    body: 'Connect today’s work to the goals and life you are building.',
  },
  {
    title: 'Stay in control of AI',
    body: 'Preview and approve every lasting change, with a clear path to undo.',
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
        <p className="perimeter-tagline">Your plans, notes, and actions — connected.</p>
        <ul className="perimeter-promises">
          {promises.map((promise) => (
            <li key={promise.title}>
              <strong>{promise.title}</strong>
              <span>{promise.body}</span>
            </li>
          ))}
        </ul>
        <p className="perimeter-foot">Your data stays private and exportable.</p>
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
      aria-live="polite"
    >
      {message}
    </p>
  );
}

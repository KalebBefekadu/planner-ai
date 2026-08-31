/* A button whose label flips to "Analyzing…" tells a sighted user what is
   happening and tells a screen-reader user nothing — the accessible name of a
   control is not announced just because it changed. Every long-running action
   in the app needs a live region alongside it, so this is that region.

   `role="status"` is polite on purpose: these messages accompany work the user
   just asked for, and should not interrupt what they are reading. Errors keep
   using role="alert" separately, because those do need to interrupt. */

export function AsyncStatus({
  message,
  tone = 'busy',
}: {
  message: string;
  tone?: 'busy' | 'done';
}) {
  return (
    <p className={`async-status async-status-${tone}`} role="status">
      {message}
    </p>
  );
}

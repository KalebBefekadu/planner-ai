import { Search } from 'lucide-react';
import Link from 'next/link';

/* There was no not-found.tsx at all, so a missing page fell through to the
   Next.js default. Deleted material stays in Trash for 30 days, which makes
   "it is probably still recoverable" the honest and most useful thing to say
   here — and gives the page somewhere to send people. */
export default function NotFound() {
  return (
    <div className="state-page">
      <span className="state-icon" aria-hidden="true">
        <Search size={22} />
      </span>
      <h1>That page doesn&rsquo;t exist any more</h1>
      <p>
        It may have been renamed, or deleted. Deleted pages stay in Trash for 30 days, so it is
        probably still recoverable.
      </p>
      <div className="state-actions">
        <Link className="btn-primary" href="/">
          Back to my workspace
        </Link>
        <Link className="btn-secondary" href="/search">
          Search for it
        </Link>
      </div>
    </div>
  );
}

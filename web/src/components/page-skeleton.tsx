/* Every route in the app was server-rendered with no loading boundary, so the
   whole surface stayed blank for the length of its database round-trip. A
   skeleton is not decoration here: it tells the reader the page is coming and
   roughly what shape it will be, which is the difference between "slow" and
   "broken".

   Rows are deliberately uneven — a skeleton of identical bars reads as a
   loading spinner wearing a costume, not as text. */

export function PageSkeleton({
  rows = 3,
  layout = 'list',
  label = 'Loading',
}: {
  rows?: number;
  layout?: 'list' | 'split' | 'board';
  label?: string;
}) {
  return (
    <div className={`page skeleton-page skeleton-${layout}`}>
      {/* One polite announcement for the whole page; the bars themselves are
          decorative and must not be read out one by one. */}
      <p className="visually-hidden" role="status">
        {label}
      </p>

      <header className="skeleton-heading" aria-hidden="true">
        <span className="skeleton-bar skeleton-eyebrow" />
        <span className="skeleton-bar skeleton-title" />
        <span className="skeleton-bar skeleton-lede" />
      </header>

      <div className="skeleton-body" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <span className={`skeleton-bar skeleton-bar-${index % 4}`} />
            <span className="skeleton-bar skeleton-bar-short" />
          </div>
        ))}
      </div>

      {layout === 'split' ? (
        <aside className="skeleton-aside" aria-hidden="true">
          <span className="skeleton-bar skeleton-eyebrow" />
          <span className="skeleton-bar" />
          <span className="skeleton-bar skeleton-bar-short" />
        </aside>
      ) : null}
    </div>
  );
}

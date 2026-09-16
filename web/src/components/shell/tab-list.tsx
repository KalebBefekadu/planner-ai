'use client';

/* Shared, data-agnostic: the caller supplies the class names, so Preview and
   an authenticated route can render the same control against different
   stylesheets.

   A real tablist: arrow keys move between tabs, only the selected tab is a tab
   stop, and each tab points at the panel it controls. Used where selecting
   swaps a panel; view switchers that behave like navigation use aria-current
   instead, which is what they actually mean. */
export function TabList<T extends string>({
  label,
  className,
  activeClassName,
  value,
  onChange,
  items,
}: {
  label: string;
  className: string;
  activeClassName: string;
  value: T;
  onChange: (next: T) => void;
  items: { id: T; label: string; icon?: React.ReactNode }[];
}) {
  const move = (event: React.KeyboardEvent, index: number) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = items[(target + items.length) % items.length];
    onChange(next.id);
    const list = event.currentTarget.parentElement;
    const button = list?.querySelectorAll('button')[items.indexOf(next)];
    (button as HTMLButtonElement | undefined)?.focus();
  };
  return (
    <div className={className} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`tab-${item.id}`}
          aria-selected={value === item.id}
          aria-controls={`tabpanel-${item.id}`}
          tabIndex={value === item.id ? 0 : -1}
          className={value === item.id ? activeClassName : ''}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

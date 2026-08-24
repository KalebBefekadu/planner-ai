import Link from 'next/link';

const periods = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
] as const;

export function ReviewTabs({ active }: { active: (typeof periods)[number]['value'] }) {
  return (
    <nav className="review-tabs" aria-label="Review period">
      {periods.map((period) => (
        <Link
          key={period.value}
          href={period.value === 'week' ? '/review' : `/review?period=${period.value}`}
          aria-current={active === period.value ? 'page' : undefined}
        >
          {period.label}
        </Link>
      ))}
    </nav>
  );
}

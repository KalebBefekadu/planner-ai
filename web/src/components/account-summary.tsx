import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { AccountOverview } from '@/app/settings/account/actions';

function initials(email: string) {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2) || 'PA';
  return letters.toUpperCase();
}

function formatJoined(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/* Every value below is read from the signed-in owner's real record. Nothing on
   this screen is an inert control: a fact that can be changed carries a link to
   the section that already owns changing it, and a fact that cannot be changed
   says so rather than offering a dead button. */
export function AccountSummary({ account }: { account: AccountOverview }) {
  const facts: Array<{ term: string; value: string; change?: { href: string; label: string } }> = [
    {
      term: 'Email',
      value: account.email,
      change: { href: '/settings/security', label: 'Manage sign-in' },
    },
    { term: 'Workspace', value: account.workspaceName },
    {
      term: 'Time zone',
      value: account.timezone,
      change: { href: '/settings/preferences', label: 'Change time zone' },
    },
    { term: 'Member since', value: formatJoined(account.createdAt) },
  ];

  return (
    <div className="account-summary">
      <section className="account-identity">
        <span className="account-avatar" aria-hidden="true">
          {initials(account.email)}
        </span>
        <div>
          <strong>{account.email}</strong>
          <small>Owner · {account.workspaceName}</small>
        </div>
      </section>

      <section className="settings-section account-facts">
        <div className="settings-section-heading">
          <div>
            <h2>Profile</h2>
          </div>
        </div>
        <dl>
          {facts.map((fact) => (
            /* A dl may only contain dt/dd pairs, optionally wrapped in a
               plain div, so the link belongs inside the dd it describes
               rather than beside it (WCAG 1.3.1). */
            <div className="account-fact" key={fact.term}>
              <dt>{fact.term}</dt>
              <dd>
                <span className="account-fact-value">{fact.value}</span>
                {fact.change ? (
                  <Link className="account-fact-link" href={fact.change.href}>
                    {fact.change.label}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="account-fact-note">Set when the workspace was created</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

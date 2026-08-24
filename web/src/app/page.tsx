import Link from 'next/link';
import { ArrowRight, CheckCircle2, Inbox, Plus, Target } from 'lucide-react';
import { getGoalsHierarchy, getTranscripts } from '@/app/actions';
import { getTodayData } from '@/app/today/actions';
import { TodayWorkspace } from '@/components/today-workspace';

export default async function TodayPage() {
  if (process.env.PLANNER_DATA_MODEL === 'canonical') {
    return <TodayWorkspace data={await getTodayData()} />;
  }
  const [plan, captures] = await Promise.all([getGoalsHierarchy(), getTranscripts(5)]);
  const allItems = plan ? [...plan.yearly, ...plan.quarterly, ...plan.monthly, ...plan.weekly] : [];
  const activeWeekly = plan?.weekly.filter((item) => item.status !== 'completed').slice(0, 3) ?? [];
  const completed = allItems.filter((item) => item.status === 'completed').length;
  const open = allItems.length - completed;
  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  return (
    <div className="page today-page">
      <header className="page-heading today-heading">
        <div>
          <p className="eyebrow">{today}</p>
          <h1>Today</h1>
          <p className="lede">Choose the few actions that deserve your attention now.</p>
        </div>
        <Link className="btn-primary button-with-icon" href="/inbox">
          <Plus size={16} aria-hidden="true" />
          New capture
        </Link>
      </header>

      <section className="today-metrics" aria-label="Planning summary">
        <div className="metric-block">
          <Target size={18} aria-hidden="true" />
          <div>
            <strong>{open}</strong>
            <span>Open items</span>
          </div>
        </div>
        <div className="metric-block">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div>
            <strong>{completed}</strong>
            <span>Completed</span>
          </div>
        </div>
        <div className="metric-block">
          <Inbox size={18} aria-hidden="true" />
          <div>
            <strong>{captures.length}</strong>
            <span>Recent captures</span>
          </div>
        </div>
      </section>

      <div className="today-grid">
        <section className="today-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Focus</p>
              <h2>This week&apos;s priorities</h2>
            </div>
            <Link href="/goals" aria-label="Open plan">
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="focus-list">
            {activeWeekly.length ? (
              activeWeekly.map((item, index) => (
                <article className="focus-row" key={item.id}>
                  <span className="focus-index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{item.content}</h3>
                    <p>{item.status === 'in_progress' ? 'In progress' : 'Ready'}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="inline-empty">
                <p>No weekly priorities are set.</p>
                <Link href="/goals">Choose from your plan</Link>
              </div>
            )}
          </div>
        </section>

        <section className="today-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Inbox</p>
              <h2>Recent thoughts</h2>
            </div>
            <Link href="/inbox" aria-label="Open capture inbox">
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="capture-preview-list">
            {captures.length ? (
              captures.map((capture) => (
                <article className="capture-preview" key={capture.id}>
                  <p>{capture.raw_text}</p>
                  <time dateTime={capture.created_at}>
                    {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
                      new Date(capture.created_at)
                    )}
                  </time>
                </article>
              ))
            ) : (
              <div className="inline-empty">
                <p>Your unstructured thoughts will land here.</p>
                <Link href="/inbox">Make a capture</Link>
              </div>
            )}
          </div>
        </section>
      </div>

      {!plan?.vision ? (
        <section className="direction-band">
          <div>
            <p className="eyebrow">Direction</p>
            <h2>Give your planning a North Star</h2>
          </div>
          <p>A Vision makes it easier to decide what belongs in your plan and what can wait.</p>
          <Link className="btn-secondary" href="/vision">
            Draft vision
          </Link>
        </section>
      ) : null}
    </div>
  );
}

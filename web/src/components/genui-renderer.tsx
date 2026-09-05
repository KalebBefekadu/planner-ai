import Link from 'next/link';
import type { GenUiOperationProposal, GenUiParseResult } from '@/lib/genui/schema';

export function GenUiRenderer({
  result,
  onReviewOperation,
}: {
  result: GenUiParseResult;
  onReviewOperation?: (proposal: GenUiOperationProposal) => void;
}) {
  if (!result.ok) {
    return (
      <section className="genui-fallback" role="status" aria-live="polite">
        <strong>{result.fallback.title}</strong>
        <p>{result.fallback.message}</p>
      </section>
    );
  }

  return (
    <section className="genui-surface" aria-label={result.spec.title ?? 'Planner AI result'}>
      {result.spec.title ? <h3>{result.spec.title}</h3> : null}
      {result.spec.components.map((component) => {
        if (component.kind === 'text') {
          return (
            <p key={component.id} data-tone={component.tone}>
              {component.text}
            </p>
          );
        }
        if (component.kind === 'metric_group') {
          return (
            <section key={component.id} aria-label={component.label ?? 'Summary'}>
              {component.label ? <h4>{component.label}</h4> : null}
              <dl>
                {component.metrics.map((metric) => (
                  <div key={metric.label}>
                    <dt>{metric.label}</dt>
                    <dd>{metric.value}</dd>
                    {metric.detail ? <p>{metric.detail}</p> : null}
                  </div>
                ))}
              </dl>
            </section>
          );
        }
        if (component.kind === 'record_list') {
          return (
            <section key={component.id}>
              <h4>{component.label}</h4>
              {component.records.length ? (
                <ul>
                  {component.records.map((record) => (
                    <li key={record.id}>
                      {record.href ? <Link href={record.href}>{record.title}</Link> : record.title}
                      {record.subtitle ? <span>{record.subtitle}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No matching items.</p>
              )}
            </section>
          );
        }
        if (component.kind === 'notice') {
          return (
            <aside key={component.id} role={component.tone === 'error' ? 'alert' : 'status'}>
              <strong>{component.title}</strong>
              <p>{component.body}</p>
            </aside>
          );
        }
        return (
          <section key={component.id} className="genui-operation-proposal">
            <strong>{component.summary}</strong>
            <span>{component.risk} risk</span>
            <button
              type="button"
              onClick={() => onReviewOperation?.(component)}
              disabled={!onReviewOperation}
            >
              Review change
            </button>
          </section>
        );
      })}
    </section>
  );
}

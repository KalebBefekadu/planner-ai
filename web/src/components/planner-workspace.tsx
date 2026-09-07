'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Archive,
  CalendarDays,
  CalendarPlus,
  CircleCheckBig,
  Compass,
  Layers3,
  ListTodo,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Save,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react';
import { assessGoalPace, summariseDrift } from '@/lib/goal-pace';
import {
  archiveActionTemplate,
  archiveGoal,
  createActionTemplate,
  createGoal,
  materializeActionTemplate,
  movePlanAction,
  setActionTemplateStatus,
  updateActionTemplate,
  updatePlanAction,
  updatePlanGoal,
  updateGoalStatus,
  type ActionTemplateView,
  type GoalType,
  type GoalView,
  type GoalsData,
} from '@/app/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { MeasuredFill } from '@/components/measured-fill';

type ComposerTarget = { type: GoalType; parentId: string; label: string } | null;
type GoalItem = GoalView;
type EditTarget = { type: GoalType; item: GoalItem } | null;
type HorizonFilter = 'all' | GoalType;

const labels: Record<GoalType, string> = {
  yearly: 'Yearly goal',
  quarterly: 'Quarterly goal',
  monthly: 'Monthly action',
  weekly: 'Weekly action',
};
const childTypes: Partial<Record<GoalType, GoalType>> = {
  yearly: 'quarterly',
  quarterly: 'monthly',
  monthly: 'weekly',
};

function messageFor(error: unknown) {
  return actionFailureMessage(error, 'Something went wrong. Please try again.');
}

export function PlannerWorkspace({
  initialData,
  initialTemplates,
}: {
  initialData: GoalsData | null;
  initialTemplates: ActionTemplateView[] | null;
}) {
  const [composer, setComposer] = useState<ComposerTarget>(null);
  const [content, setContent] = useState('');
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [templateEditor, setTemplateEditor] = useState<ActionTemplateView | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [horizonFilter, setHorizonFilter] = useState<HorizonFilter>('all');
  const [isPending, startTransition] = useTransition();

  function openComposer(type: GoalType, parentId: string) {
    setComposer({ type, parentId, label: labels[type] });
    setContent('');
    setError(null);
  }

  function createItem() {
    if (!composer) return;
    setError(null);
    startTransition(async () => {
      try {
        await createGoal({ type: composer.type, parentId: composer.parentId, content });
        setNotice(`${composer.label} added to your plan.`);
        setComposer(null);
        setContent('');
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function toggleItem(type: GoalType, item: GoalItem) {
    setError(null);
    startTransition(async () => {
      try {
        await updateGoalStatus(
          type,
          item.id,
          item.status === 'completed' ? 'pending' : 'completed',
          item.version
        );
        setNotice(`${labels[type]} updated.`);
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function archiveItem(type: GoalType, id: string, expectedVersion: number) {
    if (!window.confirm(`Archive this ${labels[type].toLowerCase()} and any items beneath it?`))
      return;
    setError(null);
    startTransition(async () => {
      try {
        await archiveGoal(type, id, expectedVersion);
        setNotice(`${labels[type]} archived.`);
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function saveEdit(formData: FormData) {
    if (!editTarget) return;
    const { type, item } = editTarget;
    const title = String(formData.get('title') ?? '');
    const descriptionMarkdown = String(formData.get('description') ?? '') || null;
    const date = String(formData.get('date') ?? '') || null;
    const destination = String(formData.get('destination') ?? '');
    setError(null);
    startTransition(async () => {
      try {
        if (type === 'yearly' || type === 'quarterly') {
          const targetText = String(formData.get('targetValue') ?? '');
          const currentText = String(formData.get('currentValue') ?? '');
          const unit = String(formData.get('unit') ?? '').trim() || null;
          await updatePlanGoal({
            id: item.id,
            expectedVersion: item.version,
            title,
            descriptionMarkdown,
            parentGoalId: type === 'quarterly' ? destination : null,
            targetValue: targetText ? Number(targetText) : null,
            currentValue: targetText ? (currentText ? Number(currentText) : 0) : null,
            unit,
            dueOn: date,
          });
        } else {
          const updated = await updatePlanAction({
            id: item.id,
            expectedVersion: item.version,
            title,
            descriptionMarkdown,
            scheduledOn: date,
          });
          const currentDestination = type === 'monthly' ? item.quarterly_id : item.monthly_id;
          if (destination && destination !== currentDestination) {
            await movePlanAction({
              type,
              id: item.id,
              expectedVersion: updated.version,
              targetParentId: destination,
            });
          }
        }
        setEditTarget(null);
        setNotice(`${labels[type]} saved.`);
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function saveTemplate(formData: FormData) {
    const editing = templateEditor && templateEditor !== 'new' ? templateEditor : null;
    const title = String(formData.get('title') ?? '');
    const descriptionMarkdown = String(formData.get('description') ?? '') || null;
    const goalId = String(formData.get('goalId') ?? '') || null;
    const cadence = String(formData.get('cadence')) as 'weekly' | 'monthly';
    const occurrenceOn = String(formData.get('occurrenceOn') ?? '');
    setError(null);
    startTransition(async () => {
      try {
        if (editing) {
          await updateActionTemplate({
            id: editing.id,
            expectedVersion: editing.version,
            title,
            descriptionMarkdown,
            goalId,
            cadence,
            nextOccurrenceOn: occurrenceOn,
          });
          setNotice('Recurring Action updated.');
        } else {
          await createActionTemplate({
            title,
            descriptionMarkdown,
            goalId,
            cadence,
            firstOccurrenceOn: occurrenceOn,
          });
          setNotice('Recurring Action created with its first dated occurrence.');
        }
        setTemplateEditor(null);
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function toggleTemplate(template: ActionTemplateView) {
    const status = template.status === 'active' ? 'paused' : 'active';
    setError(null);
    startTransition(async () => {
      try {
        await setActionTemplateStatus(template.id, template.version, status);
        setNotice(status === 'active' ? 'Recurring Action resumed.' : 'Recurring Action paused.');
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function createDueActions(template: ActionTemplateView) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await materializeActionTemplate(template.id, template.version);
        setNotice(
          result.createdActionIds.length === 0
            ? 'No occurrences are due.'
            : `${result.createdActionIds.length} due ${result.createdActionIds.length === 1 ? 'Action' : 'Actions'} created.`
        );
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function archiveTemplate(template: ActionTemplateView) {
    if (!window.confirm('Archive this recurring Action? Existing Actions will stay unchanged.'))
      return;
    setError(null);
    startTransition(async () => {
      try {
        await archiveActionTemplate(template.id, template.version);
        setNotice('Recurring Action archived.');
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  if (!initialData) {
    return (
      <div className="page">
        <div className="card empty-state">
          <h1>Start with your vision</h1>
          <p>Every useful plan needs a direction to work from.</p>
          <a className="btn-primary" href="/vision">
            Draft vision
          </a>
        </div>
      </div>
    );
  }

  const { vision, yearly, quarterly, monthly, weekly } = initialData;
  const goalItems = [...yearly, ...quarterly];
  const actionItems = [...monthly, ...weekly];
  const completedItems = [...goalItems, ...actionItems].filter(
    (item) => item.status === 'completed'
  ).length;
  const totalItems = goalItems.length + actionItems.length;
  const activeTemplates = initialTemplates?.filter(
    (template) => template.status === 'active'
  ).length;
  const horizonOptions: Array<{ id: HorizonFilter; label: string; count: number }> = [
    { id: 'all', label: 'All horizons', count: totalItems },
    { id: 'yearly', label: 'Year', count: yearly.length },
    { id: 'quarterly', label: 'Quarter', count: quarterly.length },
    { id: 'monthly', label: 'Month', count: monthly.length },
    { id: 'weekly', label: 'Week', count: weekly.length },
  ];
  /* Reports drift and stops there. AGENTS.md's coaching stance is to surface
     it and let the person decide what it is worth — never to quietly fix it. */
  const drift = summariseDrift([...yearly, ...quarterly]);
  const renderItem = (item: GoalItem, type: GoalType, depth: number) => {
    const childType = childTypes[type];
    return (
      <div className={`plan-item plan-depth-${depth}`} key={item.id}>
        <button
          className={`status-toggle${item.status === 'completed' ? ' status-complete' : ''}`}
          type="button"
          onClick={() => toggleItem(type, item)}
          aria-label={`Mark ${labels[type].toLowerCase()} as ${item.status === 'completed' ? 'not complete' : 'complete'}`}
          disabled={isPending}
        />
        <div className="plan-content">
          <p>{item.content}</p>
          <div className="plan-item-meta">
            <span>{labels[type]}</span>
            {item.due_on || item.scheduled_on ? (
              <time dateTime={item.due_on ?? item.scheduled_on ?? undefined}>
                {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
                  new Date(`${item.due_on ?? item.scheduled_on}T12:00:00Z`)
                )}
              </time>
            ) : null}
          </div>
          {(type === 'yearly' || type === 'quarterly') && item.target_value ? (
            <div className="goal-progress">
              <span>
                {item.current_value ?? 0} / {item.target_value} {item.unit}
              </span>
              {/* Progress alone does not say whether you are on pace for it. */}
              {(() => {
                const pace = assessGoalPace(item);
                if (pace.state === 'on-track' || pace.state === 'done') return null;
                return (
                  <span className={`goal-pace goal-pace-${pace.state}`} title={pace.reason}>
                    {pace.state === 'overdue'
                      ? 'Overdue'
                      : pace.state === 'not-started'
                        ? 'Not started'
                        : 'Behind pace'}
                  </span>
                );
              })()}
              <div aria-hidden="true">
                <MeasuredFill
                  as="i"
                  declarations={{
                    width: `${Math.min(100, ((item.current_value ?? 0) / item.target_value) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
        <div className="plan-actions">
          {childType ? (
            <button
              className="text-button"
              type="button"
              onClick={() => openComposer(childType, item.id)}
              disabled={isPending}
            >
              Add {labels[childType].replace(' goal', '').replace(' action', '')}
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            onClick={() => setEditTarget({ type, item })}
            disabled={isPending}
            aria-label={`Edit ${item.content}`}
            title="Edit"
          >
            <Pencil size={15} />
          </button>
          <button
            className="text-button text-button-danger"
            type="button"
            onClick={() => archiveItem(type, item.id, item.version)}
            disabled={isPending}
          >
            Archive
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page plan-page planner-workspace">
      <header className="page-heading planner-workspace-header">
        <div>
          <p className="eyebrow">Direction to action</p>
          <h1>Plan with a clear line of sight</h1>
          <p className="lede">
            Move from your North Star to the next useful action without losing the reason behind the
            work.
          </p>
        </div>
        <div className="page-heading-actions">
          {initialTemplates ? (
            <button
              className="btn-secondary button-with-icon"
              type="button"
              onClick={() => setTemplateEditor('new')}
              disabled={isPending}
            >
              <Repeat2 size={16} />
              Recurring Action
            </button>
          ) : null}
          <button
            className="btn-primary"
            type="button"
            onClick={() => openComposer('yearly', vision.id)}
            disabled={isPending}
          >
            Add yearly goal
          </button>
        </div>
      </header>

      <nav className="planner-horizon-tabs" aria-label="Filter plan by horizon">
        {horizonOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={horizonFilter === option.id}
            className={horizonFilter === option.id ? 'planner-horizon-active' : undefined}
            onClick={() => setHorizonFilter(option.id)}
          >
            <span>{option.label}</span>
            <small>{option.count}</small>
          </button>
        ))}
      </nav>

      <nav className="planner-flow" aria-label="Planning flow">
        <Link href="/vision">
          <Compass size={16} aria-hidden="true" />
          <span>
            <strong>Vision</strong>
            <small>The direction</small>
          </span>
        </Link>
        <span className="planner-flow-connector" aria-hidden="true" />
        <a href="#plan-horizons">
          <Target size={16} aria-hidden="true" />
          <span>
            <strong>Horizons</strong>
            <small>{yearly.length + quarterly.length} active goals</small>
          </span>
        </a>
        <span className="planner-flow-connector" aria-hidden="true" />
        <Link href="/planner/calendar">
          <CalendarDays size={16} aria-hidden="true" />
          <span>
            <strong>Calendar</strong>
            <small>{weekly.length} weekly actions</small>
          </span>
        </Link>
        <span className="planner-flow-connector" aria-hidden="true" />
        <Link href="/review">
          <CircleCheckBig size={16} aria-hidden="true" />
          <span>
            <strong>Review</strong>
            <small>Close the loop</small>
          </span>
        </Link>
      </nav>

      <section className="planner-overview" aria-label="Plan overview">
        <div>
          <Target size={17} aria-hidden="true" />
          <span>Active goals</span>
          <strong>{goalItems.filter((item) => item.status !== 'completed').length}</strong>
        </div>
        <div>
          <ListTodo size={17} aria-hidden="true" />
          <span>Open actions</span>
          <strong>{actionItems.filter((item) => item.status !== 'completed').length}</strong>
        </div>
        <div>
          <CircleCheckBig size={17} aria-hidden="true" />
          <span>Completed</span>
          <strong>{completedItems}</strong>
        </div>
        <div>
          <Repeat2 size={17} aria-hidden="true" />
          <span>Active routines</span>
          <strong>{activeTemplates ?? 0}</strong>
        </div>
      </section>

      {drift.headline ? (
        <aside className="drift-banner" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <strong>{drift.headline}</strong>
            <p>Nothing has been changed. Review each one and decide what it is worth.</p>
          </div>
        </aside>
      ) : null}

      {notice ? (
        <p className="status-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      {composer ? (
        <section className="card goal-composer">
          <div>
            <p className="eyebrow">New item</p>
            <h2 id="goal-composer-label">{composer.label}</h2>
          </div>
          <textarea
            aria-labelledby="goal-composer-label"
            className="input-field"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={`Describe this ${composer.label.toLowerCase()}...`}
            autoFocus
          />
          <div className="composer-actions">
            <button
              className="btn-secondary"
              type="button"
              onClick={() => setComposer(null)}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              type="button"
              onClick={createItem}
              disabled={isPending || content.trim().length < 3}
            >
              {/* "Add Yearly goal" here collided with the "Add yearly goal"
                  button that opens this composer: the two differ only in case,
                  so they are the same name to a screen reader and ambiguous to
                  voice control. Saving is also the more accurate verb for the
                  second step. */}
              {isPending ? 'Saving...' : `Save ${composer.label.toLowerCase()}`}
            </button>
          </div>
        </section>
      ) : null}

      <section className="vision-anchor planner-direction-band">
        <div className="planner-direction-icon" aria-hidden="true">
          <Layers3 size={18} />
        </div>
        <div>
          <p className="eyebrow">North Star</p>
          <p>{vision.content}</p>
        </div>
        <a href="/vision">Edit vision</a>
      </section>

      {initialTemplates ? (
        <section className="recurrence-section" aria-labelledby="recurrence-title">
          <header>
            <div>
              <p className="eyebrow">Simple recurrence</p>
              <h2 id="recurrence-title">Recurring Actions</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setTemplateEditor('new')}
              disabled={isPending}
              aria-label="Create recurring Action"
              title="Create recurring Action"
            >
              <Plus size={17} />
            </button>
          </header>
          {initialTemplates.length === 0 ? (
            <div className="recurrence-empty">
              <p>No recurring Actions yet.</p>
              <button
                className="text-button"
                type="button"
                onClick={() => setTemplateEditor('new')}
              >
                Create one
              </button>
            </div>
          ) : (
            <div className="recurrence-list">
              {initialTemplates.map((template) => (
                <article className="recurrence-item" key={template.id}>
                  <div className="recurrence-mark" aria-hidden="true">
                    <Repeat2 size={17} />
                  </div>
                  <div className="recurrence-copy">
                    <h3>{template.title}</h3>
                    <p>
                      {template.cadence === 'weekly' ? 'Weekly' : 'Monthly'} · Next{' '}
                      <time dateTime={template.nextOccurrenceOn}>
                        {new Intl.DateTimeFormat('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(`${template.nextOccurrenceOn}T12:00:00Z`))}
                      </time>
                      {template.status === 'paused' ? ' · Paused' : ''}
                    </p>
                  </div>
                  <div className="recurrence-actions">
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => createDueActions(template)}
                      disabled={isPending || template.status === 'paused'}
                      aria-label={`Create due Actions for ${template.title}`}
                      title="Create due Actions"
                    >
                      <CalendarPlus size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => toggleTemplate(template)}
                      disabled={isPending}
                      aria-label={`${template.status === 'active' ? 'Pause' : 'Resume'} ${template.title}`}
                      title={template.status === 'active' ? 'Pause' : 'Resume'}
                    >
                      {template.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => setTemplateEditor(template)}
                      disabled={isPending}
                      aria-label={`Edit ${template.title}`}
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button icon-button-danger"
                      type="button"
                      onClick={() => archiveTemplate(template)}
                      disabled={isPending}
                      aria-label={`Archive ${template.title}`}
                      title="Archive"
                    >
                      <Archive size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="plan-tree" id="plan-horizons" aria-label="Goal hierarchy">
        {yearly.length === 0 ? (
          <div className="card empty-state">
            <h2>No yearly goals yet</h2>
            <p>Choose one meaningful result that moves your vision forward.</p>
            <button
              className="btn-primary"
              type="button"
              onClick={() => openComposer('yearly', vision.id)}
            >
              Create first goal
            </button>
          </div>
        ) : horizonFilter === 'yearly' ? (
          yearly.map((item) => renderItem(item, 'yearly', 0))
        ) : horizonFilter === 'quarterly' ? (
          quarterly.map((item) => renderItem(item, 'quarterly', 0))
        ) : horizonFilter === 'monthly' ? (
          monthly.map((item) => renderItem(item, 'monthly', 0))
        ) : horizonFilter === 'weekly' ? (
          weekly.map((item) => renderItem(item, 'weekly', 0))
        ) : (
          yearly.map((yearlyGoal) => (
            <div className="plan-branch" key={yearlyGoal.id}>
              {renderItem(yearlyGoal, 'yearly', 0)}
              {quarterly
                .filter((item) => item.yearly_id === yearlyGoal.id)
                .map((quarterlyGoal) => (
                  <div key={quarterlyGoal.id}>
                    {renderItem(quarterlyGoal, 'quarterly', 1)}
                    {monthly
                      .filter((item) => item.quarterly_id === quarterlyGoal.id)
                      .map((monthlyTask) => (
                        <div key={monthlyTask.id}>
                          {renderItem(monthlyTask, 'monthly', 2)}
                          {weekly
                            .filter((item) => item.monthly_id === monthlyTask.id)
                            .map((weeklyAction) => renderItem(weeklyAction, 'weekly', 3))}
                        </div>
                      ))}
                  </div>
                ))}
            </div>
          ))
        )}
      </section>

      {editTarget ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setEditTarget(null)}
        >
          <section
            className="action-edit-dialog plan-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-edit-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">{labels[editTarget.type]}</p>
                <h2 id="plan-edit-title">Edit plan item</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setEditTarget(null)}
                aria-label="Close editor"
                title="Close"
              >
                <X size={17} />
              </button>
            </header>
            <form action={saveEdit}>
              <label>
                Title
                <input
                  className="input-field"
                  name="title"
                  defaultValue={editTarget.item.content}
                  minLength={3}
                  maxLength={1000}
                  required
                />
              </label>
              <label>
                {editTarget.type === 'yearly' || editTarget.type === 'quarterly'
                  ? 'Due date'
                  : 'Scheduled date'}
                <input
                  className="input-field"
                  type="date"
                  name="date"
                  defaultValue={editTarget.item.due_on ?? editTarget.item.scheduled_on ?? ''}
                />
              </label>

              {editTarget.type === 'quarterly' ? (
                <label>
                  Yearly Goal
                  <select
                    className="input-field"
                    name="destination"
                    defaultValue={editTarget.item.yearly_id}
                    required
                  >
                    {yearly.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.content}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {editTarget.type === 'monthly' || editTarget.type === 'weekly' ? (
                <label>
                  {editTarget.type === 'monthly' ? 'Quarterly Goal' : 'Monthly Action'}
                  <select
                    className="input-field"
                    name="destination"
                    defaultValue={
                      editTarget.type === 'monthly'
                        ? editTarget.item.quarterly_id
                        : editTarget.item.monthly_id
                    }
                    required
                  >
                    {(editTarget.type === 'monthly' ? quarterly : monthly).map((parent) => (
                      <option key={parent.id} value={parent.id}>
                        {parent.content}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {editTarget.type === 'yearly' || editTarget.type === 'quarterly' ? (
                <fieldset className="outcome-fields">
                  <legend>Outcome progress</legend>
                  <label>
                    Current
                    <input
                      className="input-field"
                      type="number"
                      name="currentValue"
                      min="0"
                      step="any"
                      defaultValue={editTarget.item.current_value ?? ''}
                    />
                  </label>
                  <label>
                    Target
                    <input
                      className="input-field"
                      type="number"
                      name="targetValue"
                      min="0.000001"
                      step="any"
                      defaultValue={editTarget.item.target_value ?? ''}
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      className="input-field"
                      name="unit"
                      maxLength={80}
                      defaultValue={editTarget.item.unit ?? ''}
                    />
                  </label>
                </fieldset>
              ) : null}

              <label>
                Details
                <textarea
                  className="input-field"
                  name="description"
                  rows={5}
                  maxLength={50_000}
                  defaultValue={editTarget.item.description ?? ''}
                />
              </label>
              <div className="dialog-actions">
                <button className="btn-secondary" type="button" onClick={() => setEditTarget(null)}>
                  Cancel
                </button>
                <button className="btn-primary button-with-icon" type="submit" disabled={isPending}>
                  <Save size={16} />
                  {isPending ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {templateEditor ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setTemplateEditor(null)}
        >
          <section
            className="action-edit-dialog recurrence-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recurrence-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">Recurring Action</p>
                <h2 id="recurrence-dialog-title">
                  {templateEditor === 'new' ? 'Create template' : 'Edit template'}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setTemplateEditor(null)}
                aria-label="Close recurring Action editor"
                title="Close"
              >
                <X size={17} />
              </button>
            </header>
            <form action={saveTemplate}>
              <label>
                Title
                <input
                  className="input-field"
                  name="title"
                  minLength={3}
                  maxLength={1000}
                  defaultValue={templateEditor === 'new' ? '' : templateEditor.title}
                  required
                  autoFocus
                />
              </label>
              <div className="recurrence-fields">
                <label>
                  Repeats
                  <select
                    className="input-field"
                    name="cadence"
                    defaultValue={templateEditor === 'new' ? 'weekly' : templateEditor.cadence}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label>
                  {templateEditor === 'new' ? 'First occurrence' : 'Next occurrence'}
                  <input
                    className="input-field"
                    type="date"
                    name="occurrenceOn"
                    defaultValue={
                      templateEditor === 'new'
                        ? new Date().toISOString().slice(0, 10)
                        : templateEditor.nextOccurrenceOn
                    }
                    required
                  />
                </label>
              </div>
              <label>
                Goal
                <select
                  className="input-field"
                  name="goalId"
                  defaultValue={templateEditor === 'new' ? '' : (templateEditor.goalId ?? '')}
                >
                  <option value="">No linked Goal</option>
                  {[...yearly, ...quarterly].map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.content}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Details
                <textarea
                  className="input-field"
                  name="description"
                  rows={4}
                  maxLength={50_000}
                  defaultValue={
                    templateEditor === 'new' ? '' : (templateEditor.descriptionMarkdown ?? '')
                  }
                />
              </label>
              <div className="dialog-actions">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setTemplateEditor(null)}
                >
                  Cancel
                </button>
                <button className="btn-primary button-with-icon" type="submit" disabled={isPending}>
                  <Save size={16} />
                  {isPending ? 'Saving...' : 'Save template'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

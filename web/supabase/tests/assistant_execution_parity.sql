-- The assistant is only worth trusting if an approved suggestion goes through
-- exactly the same governed Operation the interface uses, leaves the same
-- durable Receipt and Activity entry, and can be undone the same way. This
-- file walks the critical Notes and Planner workflows named in the roadmap --
-- writing and editing and linking a Note, filing a Capture, creating a Goal
-- and an Action, scheduling it, putting it on today, and closing the week --
-- through the approval path rather than the interface path, and asserts that
-- the trail left behind is indistinguishable in kind and correctly attributed
-- to the assistant.
--
-- It then pins the other half of the promise: an approval that cannot succeed
-- must change nothing and say so, and must not be reachable twice, after a
-- dismissal, or by anyone but the owner.
begin;
select plan(30);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'parity-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'parity-stranger@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);

-- A Vision is the root of the planning hierarchy, and a Goal cannot exist
-- without one. Creating it by hand here keeps the assertions below about the
-- assistant rather than about setup.
select public.execute_ui_operation(
  'vision.upsert.v1', '{"bodyMarkdown":"A calmer year."}'::jsonb, 'parity-vision-0001'
);

create temporary table parity_run (label text primary key, proposal_id uuid, result jsonb) on commit drop;

-- Every workflow below follows the same shape: the assistant records a turn
-- carrying one Proposal, and the person approves it. Nothing here supplies the
-- Operation input at approval time -- that is the point, the input executed is
-- the one that was persisted when the suggestion was made.
create or replace function pg_temp.approve(p_label text, p_proposal jsonb) returns jsonb as $$
declare
  v_turn jsonb;
  v_result jsonb;
begin
  v_turn := public.record_assistant_turn(
    null, 'Please do this.', 'Here is what I would change.', '/', p_proposal,
    'test-model', 'test-prompt-v1', '[]'::jsonb
  );
  v_result := public.execute_assistant_proposal((v_turn ->> 'proposalId')::uuid);
  insert into parity_run values (p_label, (v_turn ->> 'proposalId')::uuid, v_result);
  return v_result;
end;
$$ language plpgsql;

-- Notes: write one, edit it, and connect it to another.
select lives_ok(
  $$select pg_temp.approve('note.create', '{"operationId":"note.create.v1","input":{"title":"Assistant note","bodyMarkdown":"Written through approval."},"summary":"Create a Note"}'::jsonb)$$,
  'an approved suggestion writes a Note'
);
select is(
  (select body_markdown from public.notes where title = 'Assistant note'),
  'Written through approval.',
  'the Note holds exactly the text that was proposed and approved'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'note.create.v1' and surface = 'chat' and actor_type = 'assistant'
     and status = 'succeeded'),
  1,
  'the write leaves one durable Receipt attributed to the assistant'
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id = 'note.create.v1' and surface = 'chat' and actor_type = 'assistant'
     and outcome = 'succeeded'),
  1,
  'the write appears in Activity as assistant work, not as the user typing'
);

select lives_ok(
  $$select pg_temp.approve('note.update', jsonb_build_object(
    'operationId', 'note.update.v1',
    'input', jsonb_build_object(
      'id', (select id from public.notes where title = 'Assistant note'),
      'title', 'Assistant note',
      'bodyMarkdown', 'Edited through approval.',
      'expectedVersion', (select version from public.notes where title = 'Assistant note')
    ),
    'summary', 'Edit the Note'))$$,
  'an approved suggestion edits an existing Note'
);
select is(
  (select body_markdown from public.notes where title = 'Assistant note'),
  'Edited through approval.',
  'the edit reached the Note'
);

select public.execute_ui_operation(
  'note.create.v1', '{"title":"Link target","bodyMarkdown":"b"}'::jsonb, 'parity-note-target-01'
);
select lives_ok(
  $$select pg_temp.approve('note.link', jsonb_build_object(
    'operationId', 'note.link.v1',
    'input', jsonb_build_object(
      'sourceNoteId', (select id from public.notes where title = 'Assistant note'),
      'targetNoteId', (select id from public.notes where title = 'Link target'),
      'relationType', 'related'),
    'summary', 'Connect the two Notes'))$$,
  'an approved suggestion connects two Notes'
);
select is((select count(*)::integer from public.note_links), 1, 'the connection persists');

-- Capture filing: the raw words are kept, and filing them is a governed move.
select public.execute_ui_operation(
  'capture.create.v1', '{"rawText":"  Ring the venue.  ","source":"typed"}'::jsonb, 'parity-capture-0001'
);
select lives_ok(
  $$select pg_temp.approve('capture.file', jsonb_build_object(
    'operationId', 'capture.file-to-note.v1',
    'input', jsonb_build_object(
      'captureId', (select id from public.captures limit 1),
      'noteId', (select id from public.notes where title = 'Assistant note')),
    'summary', 'File the Capture into the Note'))$$,
  'an approved suggestion files a Capture into a Note'
);
select is(
  (select raw_text from public.captures limit 1),
  '  Ring the venue.  ',
  'filing a Capture never rewrites the words that were captured'
);

-- Planner: a Goal, an Action under it, a reschedule, and today's focus.
select lives_ok(
  $$select pg_temp.approve('goal.create', '{"operationId":"goal.create.v1","input":{"title":"Host the summer party","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null},"summary":"Create a Goal"}'::jsonb)$$,
  'an approved suggestion creates a Goal'
);
select lives_ok(
  $$select pg_temp.approve('action.create', jsonb_build_object(
    'operationId', 'action.create.v1',
    'input', jsonb_build_object(
      'title', 'Book the venue', 'horizonKind', 'week',
      'startsOn', '2026-06-01', 'endsOn', '2026-06-07',
      'goalId', (select id from public.goals where title = 'Host the summer party'),
      'parentActionId', null, 'scheduledOn', '2026-06-02'),
    'summary', 'Create an Action'))$$,
  'an approved suggestion creates an Action under that Goal'
);
-- Rescheduling is the same Operation the planner interface uses, and today's
-- focus is set for the real current date because a focus more than a month
-- away is refused by design.
select lives_ok(
  $$select pg_temp.approve('action.update', jsonb_build_object(
    'operationId', 'action.update.v1',
    'input', jsonb_build_object(
      'id', (select id from public.actions where title = 'Book the venue'),
      'expectedVersion', (select version from public.actions where title = 'Book the venue'),
      'title', 'Book the venue',
      'descriptionMarkdown', 'Call before noon.',
      'scheduledOn', current_date::text),
    'summary', 'Reschedule the Action'))$$,
  'an approved suggestion reschedules an Action'
);
select is(
  (select scheduled_on from public.actions where title = 'Book the venue'),
  current_date,
  'the Action moved to the proposed day'
);
select lives_ok(
  $$select pg_temp.approve('daily-focus.set', jsonb_build_object(
    'operationId', 'daily-focus.set.v1',
    'input', jsonb_build_object(
      'focusOn', current_date::text,
      'actionIds', jsonb_build_array((select id from public.actions where title = 'Book the venue'))),
    'summary', 'Put the Action on today'))$$,
  'an approved suggestion sets the focus for a day'
);
select is((select count(*)::integer from public.daily_focus_items), 1, 'the day has its focus Action');

select lives_ok(
  $$select pg_temp.approve('review.period', '{"operationId":"review.complete-period.v1","input":{"kind":"monthly","startsOn":"2026-08-01","endsOn":"2026-08-31","reflectionMarkdown":"A steady month."},"summary":"Close the month"}'::jsonb)$$,
  'an approved suggestion closes a period Review'
);
select is((select count(*)::integer from public.reviews where kind = 'monthly'), 1, 'the Review is recorded');

-- The trail, taken as a whole. Nine approvals, nine Receipts, nine Activity
-- entries: no approval executed twice, and none executed without a record.
select is(
  (select count(*)::integer from public.ai_proposals where status = 'applied'),
  (select count(*)::integer from public.operation_receipts where surface = 'chat' and status = 'succeeded'),
  'every applied Proposal left exactly one succeeded Receipt and no extras'
);
select is(
  (select count(*)::integer from public.operation_receipts r
   where r.surface = 'chat' and r.status = 'succeeded' and not exists (
     select 1 from public.activity_events e
     where e.operation_id = r.operation_id and e.target_id is not distinct from r.target_id
       and e.surface = 'chat' and e.outcome = 'succeeded')),
  0,
  'no assistant Receipt exists without a matching Activity entry'
);

-- Undo. The promise on the sign-in page is that a change can be taken back,
-- and an assistant change is no exception.
select lives_ok(
  $$select pg_temp.approve('note.undoable', '{"operationId":"note.create.v1","input":{"title":"Undo me","bodyMarkdown":"b"},"summary":"Create a Note to undo"}'::jsonb)$$,
  'an approved suggestion writes the Note that undo will take back'
);
select isnt(
  (select result ->> 'undoableReceiptId' from parity_run where label = 'note.undoable'),
  null,
  'a reversible assistant change hands back the Receipt needed to undo it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object('receiptId', (select result ->> 'undoableReceiptId' from parity_run where label = 'note.undoable')),
    'parity-undo-000001')$$,
  'the assistant Note can be undone through the ordinary undo Operation'
);
select is(
  (select count(*)::integer from public.notes where title = 'Undo me' and trashed_at is null),
  0,
  'undo actually removed the Note the assistant wrote'
);

-- An approval is spent once. Pressing Approve again must not apply a second
-- copy of the change; the dock relies on this refusal to stop offering it.
select throws_ok(
  $$select public.execute_assistant_proposal((select proposal_id from parity_run where label = 'goal.create'))$$,
  'P0001', 'proposal_not_found',
  'an already-applied Proposal cannot be approved a second time'
);

-- A Proposal carries the version it was written against. When the record has
-- moved on, the approval must fail whole: no partial write, no Receipt, and
-- the Proposal left pending rather than marked applied.
select public.execute_ui_operation(
  'note.create.v1', '{"title":"Moved on","bodyMarkdown":"b"}'::jsonb, 'parity-note-stale-01'
);
select public.record_assistant_turn(
  null, 'Rename it.', 'Here is the rename.', '/notes',
  jsonb_build_object('operationId', 'note.update.v1', 'input', jsonb_build_object(
    'id', (select id from public.notes where title = 'Moved on'),
    'title', 'Renamed', 'bodyMarkdown', 'b', 'expectedVersion', 99),
    'summary', 'Rename the Note'),
  'test-model', 'test-prompt-v1', '[]'::jsonb
);
select throws_ok(
  $$select public.execute_assistant_proposal(
    (select id from public.ai_proposals where status = 'pending' and operation_id = 'note.update.v1'))$$,
  '40001', 'version_conflict_or_not_found',
  'a Proposal written against a stale version refuses rather than overwriting'
);
select is(
  (select count(*)::integer from public.notes where title = 'Renamed'),
  0,
  'the refused approval changed nothing'
);

-- A dismissal is a decision, and it must hold.
select public.dismiss_assistant_proposal(
  (select id from public.ai_proposals where status = 'pending' and operation_id = 'note.update.v1')
);
select throws_ok(
  $$select public.execute_assistant_proposal(
    (select id from public.ai_proposals where status = 'dismissed' and operation_id = 'note.update.v1'))$$,
  'P0001', 'proposal_not_found',
  'a dismissed Proposal cannot be approved afterwards'
);

-- Someone else's pending Proposal is not an instruction this account can carry
-- out, and the refusal is worded identically so it cannot be used to discover
-- that the Proposal exists.
-- The id is stashed outside the owner's row-level view first, so the stranger
-- is genuinely refused rather than merely unable to find the Proposal.
insert into parity_run (label, proposal_id)
select 'stranger-target', (public.record_assistant_turn(
  null, 'Add a Goal.', 'Here it is.', '/',
  '{"operationId":"goal.create.v1","input":{"title":"Private plan","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null},"summary":"Create a private Goal"}'::jsonb,
  'test-model', 'test-prompt-v1', '[]'::jsonb
) ->> 'proposalId')::uuid;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.execute_assistant_proposal(
    (select proposal_id from parity_run where label = 'stranger-target'))$$,
  'P0001', 'proposal_not_found',
  'another account cannot approve a Proposal it does not own'
);
select is(
  (select count(*)::integer from public.goals where title = 'Private plan'),
  0,
  'the stranger''s approval created nothing'
);

select * from finish();
rollback;

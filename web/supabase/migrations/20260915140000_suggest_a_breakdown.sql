-- A new initiative can ask for a first list.
--
-- The proposal machinery already exists and is reused whole: an immutable
-- Capture records that the owner asked, persist_capture_proposal_analysis_job
-- writes the batch atomically, and the Action Inbox reviews it. What is new is
-- one job kind, so a breakdown is distinguishable from a Capture the owner
-- typed themselves in Activity and in the job history.
--
-- The model's only influence is a list of task titles. Every identifier, date
-- and horizon in the resulting action.create.v1 inputs is computed by the
-- server from the initiative it was asked about, and each one is validated
-- against the Operation's own schema before anything is written. A model that
-- returns nonsense produces zero proposals rather than a bad write.

begin;

alter table public.ai_jobs
  drop constraint ai_jobs_operation_check;
alter table public.ai_jobs
  add constraint ai_jobs_operation_check check (
    operation in ('capture_analysis', 'review_analysis', 'initiative_breakdown')
  );

commit;

begin;
select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'vault-import-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);

-- An exported vault records parentage by Note identity, so parent paths neither
-- end in '/' nor prefix their children. The child is listed first and sorts
-- before its parent by identity, which is the order that used to lose hierarchy.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"planner-ai-notes.zip",
      "sourceType":"generic",
      "items":[
        {"sourcePath":"planner-ai-vault/aaaaaaaa-2222-2222-2222-222222222222","title":"Child","bodyMarkdown":"Child body","parentSourcePath":"planner-ai-vault/ffffffff-1111-1111-1111-111111111111","unsupportedReason":null},
        {"sourcePath":"planner-ai-vault/ffffffff-1111-1111-1111-111111111111","title":"Parent","bodyMarkdown":"Parent body","parentSourcePath":null,"unsupportedReason":null}
      ]
    }',
    'vault-hierarchy-0001'
  )$$,
  'a vault that records parentage by Note identity is accepted'
);

select is(
  (select sort_order from public.note_import_items where title = 'Parent'),
  1,
  'a parent is staged before its child'
);
select is(
  (select sort_order from public.note_import_items where title = 'Child'),
  2,
  'a child is staged after its parent'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    (select json_build_object('jobId', id, 'batchSize', 50)::text
     from public.note_import_jobs)::jsonb,
    'vault-hierarchy-commit-0001'
  )$$,
  'the whole vault commits in one batch'
);

select is(
  (select parent.title from public.notes child
   join public.notes parent on parent.id = child.parent_note_id
   where child.title = 'Child'),
  'Parent',
  'the committed child keeps its parent rather than becoming a root Note'
);
select is(
  (select parent_note_id from public.notes where title = 'Parent'),
  null,
  'the committed parent stays at the root'
);

-- Identity-based parentage must not admit a cycle the commit loop cannot drain.
select throws_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"cycle.zip",
      "sourceType":"generic",
      "items":[
        {"sourcePath":"planner-ai-vault/aaaaaaaa-1111-1111-1111-111111111111","title":"A","bodyMarkdown":"A","parentSourcePath":"planner-ai-vault/bbbbbbbb-1111-1111-1111-111111111111","unsupportedReason":null},
        {"sourcePath":"planner-ai-vault/bbbbbbbb-1111-1111-1111-111111111111","title":"B","bodyMarkdown":"B","parentSourcePath":"planner-ai-vault/aaaaaaaa-1111-1111-1111-111111111111","unsupportedReason":null}
      ]
    }',
    'vault-cycle-0001'
  )$$,
  'P0001', 'invalid_import_items',
  'parentage that never reaches a root is rejected before staging'
);

-- AI Exclusion is a privacy decision, so restoring a vault must not quietly
-- return an excluded Note to AI retrieval.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"exclusion.zip",
      "sourceType":"generic",
      "items":[
        {"sourcePath":"planner-ai-vault/cccccccc-1111-1111-1111-111111111111","title":"Excluded from AI","bodyMarkdown":"Private reasoning.","parentSourcePath":null,"unsupportedReason":null,"aiExcluded":true}
      ]
    }',
    'vault-exclusion-0001'
  )$$,
  'a vault records AI Exclusion per Note'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    (select json_build_object('jobId', id, 'batchSize', 50)::text
     from public.note_import_jobs
     where source_name = 'exclusion.zip')::jsonb,
    'vault-exclusion-commit-0001'
  )$$,
  'the excluded Note commits'
);

select * from finish();
rollback;

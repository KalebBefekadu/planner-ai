begin;
select plan(11);

-- Restoring a vault must return how the owner had each page arranged, not only
-- what it said. The manifest already carried sibling order and AI Exclusion; a
-- page's icon, cover, cover position and pinned state were dropped, so a
-- restore of an illustrated, favourited workspace came back as an
-- undifferentiated list with no error, because nothing had failed.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'vault-appearance-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);

-- Four pages: one fully decorated, one plain, one whose manifest entry holds a
-- cover position the column would refuse, and one that came from somewhere
-- other than a vault and therefore has no appearance at all.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"planner-ai-notes.zip",
      "sourceType":"generic",
      "items":[
        {"sourcePath":"planner-ai-vault/a1","title":"Decorated","bodyMarkdown":"Body","parentSourcePath":null,"unsupportedReason":null,
         "appearance":{"iconEmoji":"🌄","coverKey":"focus","coverPosition":23,"favoritedAt":"2026-09-01T09:30:00+00:00"}},
        {"sourcePath":"planner-ai-vault/a2","title":"Plain","bodyMarkdown":"Body","parentSourcePath":null,"unsupportedReason":null,
         "appearance":{"iconEmoji":null,"coverKey":null,"coverPosition":50,"favoritedAt":null}},
        {"sourcePath":"planner-ai-vault/a3","title":"Edited manifest","bodyMarkdown":"Body","parentSourcePath":null,"unsupportedReason":null,
         "appearance":{"iconEmoji":"📌","coverKey":null,"coverPosition":4000,"favoritedAt":null}},
        {"sourcePath":"planner-ai-vault/a4","title":"Unknown cover","bodyMarkdown":"Body","parentSourcePath":null,"unsupportedReason":null,
         "appearance":{"iconEmoji":"🗺️","coverKey":"a-cover-this-version-does-not-have","coverPosition":10,"favoritedAt":null}},
        {"sourcePath":"Notes/FromNotion.md","title":"From Notion","bodyMarkdown":"Body","parentSourcePath":null,"unsupportedReason":null}
      ]
    }',
    'vault-appearance-0001'
  )$$,
  'a vault carrying appearance is staged'
);

select is(
  (select source_icon_emoji from public.note_import_items where title = 'Decorated'),
  '🌄',
  'the icon reaches staging'
);
select is(
  (select source_cover_key from public.note_import_items where title = 'Decorated'),
  'focus',
  'the cover reaches staging'
);
select is(
  (select source_cover_position from public.note_import_items where title = 'Edited manifest'),
  null::smallint,
  'a cover position the column would refuse is dropped rather than staged'
);
select is(
  (select source_icon_emoji from public.note_import_items where title = 'Edited manifest'),
  '📌',
  'and the icon on that same page is kept, because one bad field is not all of them'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    (select json_build_object('jobId', id, 'batchSize', 50)::text
     from public.note_import_jobs)::jsonb,
    'vault-appearance-commit-0001'
  )$$,
  'the vault commits'
);

select results_eq(
  $$select icon_emoji, cover_key, cover_position, (favorited_at is not null)
    from public.notes where title = 'Decorated'$$,
  $$values ('🌄'::text, 'focus'::text, 23::smallint, true)$$,
  'a decorated page comes back decorated, pinned, and positioned where it was'
);

select results_eq(
  $$select icon_emoji, cover_key, cover_position, favorited_at
    from public.notes where title = 'Edited manifest'$$,
  $$values ('📌'::text, null::text, 50::smallint, null::timestamptz)$$,
  'a refused cover position falls back to the default instead of failing the import'
);

-- An imported Notion page has no Planner AI appearance. Inventing one would be
-- deciding on the owner's behalf and calling it a restore.
select results_eq(
  $$select icon_emoji, cover_key, cover_position, favorited_at
    from public.notes where title = 'From Notion'$$,
  $$values (null::text, null::text, 50::smallint, null::timestamptz)$$,
  'a page from outside a vault is created plain rather than given an appearance'
);

-- A vault written by a version with more covers than this one must restore
-- every page and lose one image, rather than refusing to open. A check
-- constraint can refuse a value but cannot offer a fallback, so reaching it
-- would fail the whole import on one unrecognised cover.
select results_eq(
  $$select icon_emoji, cover_key, cover_position
    from public.notes where title = 'Unknown cover'$$,
  $$values ('🗺️'::text, null::text, 10::smallint)$$,
  'an unrecognised cover is dropped, and the page keeps its icon and position'
);

select is(
  (select count(*)::integer from public.notes where trashed_at is null),
  5,
  'every page in the vault was created, including the ones with unusable fields'
);

select * from finish();
rollback;

begin;

-- Attachment objects are written by the trusted server route, never directly by a browser.
grant select, insert, update, delete on public.note_attachments to service_role;

commit;

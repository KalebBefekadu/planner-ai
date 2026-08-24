begin;

-- Provider workers authenticate as service_role and need read-only access to
-- assemble and persist bounded analysis jobs. Browser roles remain unchanged.
grant select on public.workspaces, public.captures,
  public.capture_proposal_batches, public.review_ai_proposals,
  public.ai_request_windows, public.mcp_oauth_usage_windows,
  public.trash_batch_focus_items
to service_role;
grant execute on function public.build_mcp_workspace_snapshot(uuid) to service_role;

commit;

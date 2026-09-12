export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          canceled_at: string | null;
          completed_at: string | null;
          id: string;
          last_error_code: string | null;
          processing_started_at: string | null;
          requested_at: string;
          scheduled_for: string;
          status: string;
          updated_at: string;
          user_id: string | null;
          workspace_id: string | null;
        };
        Insert: {
          canceled_at?: string | null;
          completed_at?: string | null;
          id?: string;
          last_error_code?: string | null;
          processing_started_at?: string | null;
          requested_at?: string;
          scheduled_for: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          canceled_at?: string | null;
          completed_at?: string | null;
          id?: string;
          last_error_code?: string | null;
          processing_started_at?: string | null;
          requested_at?: string;
          scheduled_for?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'account_deletion_requests_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      action_schedule_history: {
        Row: {
          action_id: string;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          new_horizon_id: string | null;
          new_scheduled_on: string | null;
          previous_horizon_id: string | null;
          previous_scheduled_on: string | null;
          reason: string;
          review_id: string | null;
          workspace_id: string;
        };
        Insert: {
          action_id: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          new_horizon_id?: string | null;
          new_scheduled_on?: string | null;
          previous_horizon_id?: string | null;
          previous_scheduled_on?: string | null;
          reason: string;
          review_id?: string | null;
          workspace_id: string;
        };
        Update: {
          action_id?: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          new_horizon_id?: string | null;
          new_scheduled_on?: string | null;
          previous_horizon_id?: string | null;
          previous_scheduled_on?: string | null;
          reason?: string;
          review_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'action_schedule_history_action_id_workspace_id_fkey';
            columns: ['action_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'actions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'action_schedule_history_new_horizon_id_workspace_id_fkey';
            columns: ['new_horizon_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'planning_horizons';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'action_schedule_history_previous_horizon_id_workspace_id_fkey';
            columns: ['previous_horizon_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'planning_horizons';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'action_schedule_history_review_id_workspace_id_fkey';
            columns: ['review_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'reviews';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'action_schedule_history_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      action_templates: {
        Row: {
          archived_at: string | null;
          cadence: string;
          created_at: string;
          description_markdown: string | null;
          goal_id: string | null;
          id: string;
          monthly_anchor_day: number | null;
          next_occurrence_on: string;
          status: string;
          title: string;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          cadence: string;
          created_at?: string;
          description_markdown?: string | null;
          goal_id?: string | null;
          id?: string;
          monthly_anchor_day?: number | null;
          next_occurrence_on: string;
          status?: string;
          title: string;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          cadence?: string;
          created_at?: string;
          description_markdown?: string | null;
          goal_id?: string | null;
          id?: string;
          monthly_anchor_day?: number | null;
          next_occurrence_on?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'action_templates_goal_id_workspace_id_fkey';
            columns: ['goal_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'goals';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'action_templates_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      actions: {
        Row: {
          archived_at: string | null;
          blocker_text: string | null;
          completed_at: string | null;
          created_at: string;
          description_markdown: string | null;
          drop_reason: string | null;
          goal_id: string | null;
          horizon_id: string;
          id: string;
          parent_action_id: string | null;
          purge_after: string | null;
          recurrence_template_id: string | null;
          scheduled_on: string | null;
          source_note_id: string | null;
          status: string;
          title: string;
          trashed_at: string | null;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          blocker_text?: string | null;
          completed_at?: string | null;
          created_at?: string;
          description_markdown?: string | null;
          drop_reason?: string | null;
          goal_id?: string | null;
          horizon_id: string;
          id?: string;
          parent_action_id?: string | null;
          purge_after?: string | null;
          recurrence_template_id?: string | null;
          scheduled_on?: string | null;
          source_note_id?: string | null;
          status?: string;
          title: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          blocker_text?: string | null;
          completed_at?: string | null;
          created_at?: string;
          description_markdown?: string | null;
          drop_reason?: string | null;
          goal_id?: string | null;
          horizon_id?: string;
          id?: string;
          parent_action_id?: string | null;
          purge_after?: string | null;
          recurrence_template_id?: string | null;
          scheduled_on?: string | null;
          source_note_id?: string | null;
          status?: string;
          title?: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'actions_goal_id_workspace_id_fkey';
            columns: ['goal_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'goals';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'actions_horizon_id_workspace_id_fkey';
            columns: ['horizon_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'planning_horizons';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'actions_parent_action_id_workspace_id_fkey';
            columns: ['parent_action_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'actions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'actions_recurrence_template_workspace_fk';
            columns: ['recurrence_template_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'action_templates';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'actions_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      activity_events: {
        Row: {
          actor_type: string;
          actor_user_id: string | null;
          approval_state: string | null;
          created_at: string;
          id: string;
          operation_id: string;
          outcome: string;
          risk_class: string;
          surface: string;
          target_id: string | null;
          target_type: string | null;
          workspace_id: string;
        };
        Insert: {
          actor_type: string;
          actor_user_id?: string | null;
          approval_state?: string | null;
          created_at?: string;
          id?: string;
          operation_id: string;
          outcome: string;
          risk_class: string;
          surface: string;
          target_id?: string | null;
          target_type?: string | null;
          workspace_id: string;
        };
        Update: {
          actor_type?: string;
          actor_user_id?: string | null;
          approval_state?: string | null;
          created_at?: string;
          id?: string;
          operation_id?: string;
          outcome?: string;
          risk_class?: string;
          surface?: string;
          target_id?: string | null;
          target_type?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_events_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_jobs: {
        Row: {
          actor_user_id: string | null;
          attempt_count: number;
          completed_at: string | null;
          created_at: string;
          error_code: string | null;
          id: string;
          operation: string;
          request_id: string;
          result_target_id: string | null;
          source_capture_id: string | null;
          source_ends_on: string | null;
          source_review_kind: string | null;
          source_starts_on: string | null;
          status: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          actor_user_id?: string | null;
          attempt_count?: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          operation: string;
          request_id: string;
          result_target_id?: string | null;
          source_capture_id?: string | null;
          source_ends_on?: string | null;
          source_review_kind?: string | null;
          source_starts_on?: string | null;
          status: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          actor_user_id?: string | null;
          attempt_count?: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          operation?: string;
          request_id?: string;
          result_target_id?: string | null;
          source_capture_id?: string | null;
          source_ends_on?: string | null;
          source_review_kind?: string | null;
          source_starts_on?: string | null;
          status?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_jobs_source_capture_id_workspace_id_fkey';
            columns: ['source_capture_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'captures';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'ai_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_proposals: {
        Row: {
          applied_at: string | null;
          batch_id: string | null;
          conversation_id: string | null;
          created_at: string;
          decided_at: string | null;
          id: string;
          idempotency_key: string;
          input_json: Json;
          model_id: string;
          operation_id: string;
          prompt_version: string;
          result_json: Json | null;
          risk_class: string;
          sort_order: number | null;
          source_capture_id: string | null;
          status: string;
          summary: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          applied_at?: string | null;
          batch_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          idempotency_key?: string;
          input_json: Json;
          model_id: string;
          operation_id: string;
          prompt_version: string;
          result_json?: Json | null;
          risk_class: string;
          sort_order?: number | null;
          source_capture_id?: string | null;
          status?: string;
          summary: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          applied_at?: string | null;
          batch_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          idempotency_key?: string;
          input_json?: Json;
          model_id?: string;
          operation_id?: string;
          prompt_version?: string;
          result_json?: Json | null;
          risk_class?: string;
          sort_order?: number | null;
          source_capture_id?: string | null;
          status?: string;
          summary?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_proposals_batch_workspace_fkey';
            columns: ['batch_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'capture_proposal_batches';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'ai_proposals_conversation_workspace_fkey';
            columns: ['conversation_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'ai_proposals_source_capture_workspace_fkey';
            columns: ['source_capture_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'captures';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'ai_proposals_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_quota_reservations: {
        Row: {
          created_at: string;
          expires_at: string;
          operation: string;
          request_id: string;
          reserved_cost_micros: number;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          operation: string;
          request_id: string;
          reserved_cost_micros: number;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          operation?: string;
          request_id?: string;
          reserved_cost_micros?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_quota_reservations_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_request_windows: {
        Row: {
          operation: string;
          request_count: number;
          updated_at: string;
          user_id: string;
          window_started_at: string;
        };
        Insert: {
          operation: string;
          request_count?: number;
          updated_at?: string;
          user_id: string;
          window_started_at: string;
        };
        Update: {
          operation?: string;
          request_count?: number;
          updated_at?: string;
          user_id?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      ai_usage_events: {
        Row: {
          actor_user_id: string | null;
          audio_seconds: number | null;
          created_at: string;
          error_code: string | null;
          estimated_cost_micros: number;
          id: string;
          input_tokens: number | null;
          latency_ms: number;
          model_id: string;
          operation: string;
          outcome: string;
          output_tokens: number | null;
          pricing_version: string;
          provider: string;
          provider_role: string;
          request_id: string;
          workspace_id: string;
        };
        Insert: {
          actor_user_id?: string | null;
          audio_seconds?: number | null;
          created_at?: string;
          error_code?: string | null;
          estimated_cost_micros?: number;
          id?: string;
          input_tokens?: number | null;
          latency_ms: number;
          model_id: string;
          operation: string;
          outcome: string;
          output_tokens?: number | null;
          pricing_version: string;
          provider: string;
          provider_role: string;
          request_id: string;
          workspace_id: string;
        };
        Update: {
          actor_user_id?: string | null;
          audio_seconds?: number | null;
          created_at?: string;
          error_code?: string | null;
          estimated_cost_micros?: number;
          id?: string;
          input_tokens?: number | null;
          latency_ms?: number;
          model_id?: string;
          operation?: string;
          outcome?: string;
          output_tokens?: number | null;
          pricing_version?: string;
          provider?: string;
          provider_role?: string;
          request_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_usage_events_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      beta_invites: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          intended_email: string | null;
          max_uses: number;
          revoked_at: string | null;
          token_hash: string;
          uses: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          intended_email?: string | null;
          max_uses?: number;
          revoked_at?: string | null;
          token_hash: string;
          uses?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          intended_email?: string | null;
          max_uses?: number;
          revoked_at?: string | null;
          token_hash?: string;
          uses?: number;
        };
        Relationships: [];
      };
      capture_action_links: {
        Row: {
          action_id: string;
          capture_id: string;
          created_at: string;
          workspace_id: string;
        };
        Insert: {
          action_id: string;
          capture_id: string;
          created_at?: string;
          workspace_id: string;
        };
        Update: {
          action_id?: string;
          capture_id?: string;
          created_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'capture_action_links_action_id_workspace_id_fkey';
            columns: ['action_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'actions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'capture_action_links_capture_id_workspace_id_fkey';
            columns: ['capture_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'captures';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'capture_action_links_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      capture_note_links: {
        Row: {
          capture_id: string;
          created_at: string;
          note_id: string;
          workspace_id: string;
        };
        Insert: {
          capture_id: string;
          created_at?: string;
          note_id: string;
          workspace_id: string;
        };
        Update: {
          capture_id?: string;
          created_at?: string;
          note_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'capture_note_links_capture_id_workspace_id_fkey';
            columns: ['capture_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'captures';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'capture_note_links_note_id_workspace_id_fkey';
            columns: ['note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'capture_note_links_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      capture_proposal_batches: {
        Row: {
          analysis_summary: string;
          applied_at: string | null;
          created_at: string;
          decided_at: string | null;
          id: string;
          insights_json: Json;
          model_id: string;
          prompt_version: string;
          source_capture_id: string;
          status: string;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          analysis_summary: string;
          applied_at?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          insights_json?: Json;
          model_id: string;
          prompt_version: string;
          source_capture_id: string;
          status?: string;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          analysis_summary?: string;
          applied_at?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          insights_json?: Json;
          model_id?: string;
          prompt_version?: string;
          source_capture_id?: string;
          status?: string;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'capture_proposal_batches_source_capture_id_workspace_id_fkey';
            columns: ['source_capture_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'captures';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'capture_proposal_batches_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      captures: {
        Row: {
          archived_at: string | null;
          audio_object_key: string | null;
          created_at: string;
          failed_audio_expires_at: string | null;
          id: string;
          purge_after: string | null;
          raw_text: string;
          source: string;
          state: string;
          transcription_status: string | null;
          trashed_at: string | null;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          audio_object_key?: string | null;
          created_at?: string;
          failed_audio_expires_at?: string | null;
          id?: string;
          purge_after?: string | null;
          raw_text: string;
          source: string;
          state?: string;
          transcription_status?: string | null;
          trashed_at?: string | null;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          audio_object_key?: string | null;
          created_at?: string;
          failed_audio_expires_at?: string | null;
          id?: string;
          purge_after?: string | null;
          raw_text?: string;
          source?: string;
          state?: string;
          transcription_status?: string | null;
          trashed_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'captures_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_messages: {
        Row: {
          claims: Json;
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          role: string;
          route: string | null;
          sources: Json;
          workspace_id: string;
        };
        Insert: {
          claims?: Json;
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          role: string;
          route?: string | null;
          sources?: Json;
          workspace_id: string;
        };
        Update: {
          claims?: Json;
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
          route?: string | null;
          sources?: Json;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_messages_conversation_workspace_fkey';
            columns: ['conversation_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'conversation_messages_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      conversations: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          status: string;
          title: string;
          trashed_at: string | null;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          status?: string;
          title: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          status?: string;
          title?: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_focus_items: {
        Row: {
          action_id: string;
          created_at: string;
          focus_on: string;
          sort_order: number;
          workspace_id: string;
        };
        Insert: {
          action_id: string;
          created_at?: string;
          focus_on: string;
          sort_order: number;
          workspace_id: string;
        };
        Update: {
          action_id?: string;
          created_at?: string;
          focus_on?: string;
          sort_order?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_focus_items_action_id_workspace_id_fkey';
            columns: ['action_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'actions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'daily_focus_items_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      goals: {
        Row: {
          achieved_at: string | null;
          archived_at: string | null;
          created_at: string;
          current_value: number | null;
          description_markdown: string | null;
          due_on: string | null;
          horizon_id: string;
          id: string;
          parent_goal_id: string | null;
          purge_after: string | null;
          status: string;
          target_value: number | null;
          title: string;
          trashed_at: string | null;
          unit: string | null;
          updated_at: string;
          version: number;
          vision_id: string;
          workspace_id: string;
        };
        Insert: {
          achieved_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          current_value?: number | null;
          description_markdown?: string | null;
          due_on?: string | null;
          horizon_id: string;
          id?: string;
          parent_goal_id?: string | null;
          purge_after?: string | null;
          status?: string;
          target_value?: number | null;
          title: string;
          trashed_at?: string | null;
          unit?: string | null;
          updated_at?: string;
          version?: number;
          vision_id: string;
          workspace_id: string;
        };
        Update: {
          achieved_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          current_value?: number | null;
          description_markdown?: string | null;
          due_on?: string | null;
          horizon_id?: string;
          id?: string;
          parent_goal_id?: string | null;
          purge_after?: string | null;
          status?: string;
          target_value?: number | null;
          title?: string;
          trashed_at?: string | null;
          unit?: string | null;
          updated_at?: string;
          version?: number;
          vision_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'goals_horizon_id_workspace_id_fkey';
            columns: ['horizon_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'planning_horizons';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'goals_parent_goal_id_workspace_id_fkey';
            columns: ['parent_goal_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'goals';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'goals_vision_id_workspace_id_fkey';
            columns: ['vision_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'visions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'goals_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      lifecycle_job_runs: {
        Row: {
          error_code: string | null;
          failed_count: number;
          finished_at: string | null;
          id: string;
          job_name: string;
          processed_count: number;
          started_at: string;
          status: string;
          succeeded_count: number;
        };
        Insert: {
          error_code?: string | null;
          failed_count?: number;
          finished_at?: string | null;
          id?: string;
          job_name: string;
          processed_count?: number;
          started_at?: string;
          status?: string;
          succeeded_count?: number;
        };
        Update: {
          error_code?: string | null;
          failed_count?: number;
          finished_at?: string | null;
          id?: string;
          job_name?: string;
          processed_count?: number;
          started_at?: string;
          status?: string;
          succeeded_count?: number;
        };
        Relationships: [];
      };
      mcp_access_tokens: {
        Row: {
          allowed_operations: string[];
          created_at: string;
          expires_at: string;
          id: string;
          last_used_at: string | null;
          name: string;
          owner_user_id: string;
          revoked_at: string | null;
          token_hash: string;
          workspace_id: string;
        };
        Insert: {
          allowed_operations?: string[];
          created_at?: string;
          expires_at: string;
          id?: string;
          last_used_at?: string | null;
          name: string;
          owner_user_id: string;
          revoked_at?: string | null;
          token_hash: string;
          workspace_id: string;
        };
        Update: {
          allowed_operations?: string[];
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          owner_user_id?: string;
          revoked_at?: string | null;
          token_hash?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mcp_access_tokens_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mcp_access_tokens_workspace_id_owner_user_id_fkey';
            columns: ['workspace_id', 'owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id', 'owner_user_id'];
          },
        ];
      };
      mcp_oauth_grants: {
        Row: {
          allowed_operations: string[];
          client_name: string;
          created_at: string;
          id: string;
          last_used_at: string | null;
          oauth_client_id: string;
          owner_user_id: string;
          revoked_at: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          allowed_operations: string[];
          client_name: string;
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          oauth_client_id: string;
          owner_user_id: string;
          revoked_at?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          allowed_operations?: string[];
          client_name?: string;
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          oauth_client_id?: string;
          owner_user_id?: string;
          revoked_at?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mcp_oauth_grants_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mcp_oauth_grants_workspace_id_owner_user_id_fkey';
            columns: ['workspace_id', 'owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id', 'owner_user_id'];
          },
        ];
      };
      mcp_oauth_usage_windows: {
        Row: {
          grant_id: string;
          request_count: number;
          window_started_at: string;
        };
        Insert: {
          grant_id: string;
          request_count?: number;
          window_started_at: string;
        };
        Update: {
          grant_id?: string;
          request_count?: number;
          window_started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mcp_oauth_usage_windows_grant_id_fkey';
            columns: ['grant_id'];
            isOneToOne: false;
            referencedRelation: 'mcp_oauth_grants';
            referencedColumns: ['id'];
          },
        ];
      };
      mcp_usage_windows: {
        Row: {
          request_count: number;
          token_id: string;
          window_started_at: string;
        };
        Insert: {
          request_count?: number;
          token_id: string;
          window_started_at: string;
        };
        Update: {
          request_count?: number;
          token_id?: string;
          window_started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mcp_usage_windows_token_id_fkey';
            columns: ['token_id'];
            isOneToOne: false;
            referencedRelation: 'mcp_access_tokens';
            referencedColumns: ['id'];
          },
        ];
      };
      memories: {
        Row: {
          created_at: string;
          id: string;
          source_id: string | null;
          source_type: string;
          statement: string;
          trashed_at: string | null;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          source_id?: string | null;
          source_type: string;
          statement: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          source_id?: string | null;
          source_type?: string;
          statement?: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memories_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_action_links: {
        Row: {
          action_id: string;
          created_at: string;
          note_id: string;
          workspace_id: string;
        };
        Insert: {
          action_id: string;
          created_at?: string;
          note_id: string;
          workspace_id: string;
        };
        Update: {
          action_id?: string;
          created_at?: string;
          note_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_action_links_action_id_workspace_id_fkey';
            columns: ['action_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'actions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_action_links_note_id_workspace_id_fkey';
            columns: ['note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_action_links_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_attachments: {
        Row: {
          byte_size: number;
          checksum_sha256: string;
          created_at: string;
          id: string;
          media_type: string;
          note_id: string;
          object_key: string;
          original_name: string;
          purge_after: string | null;
          removed_at: string | null;
          scan_state: string;
          workspace_id: string;
        };
        Insert: {
          byte_size: number;
          checksum_sha256: string;
          created_at?: string;
          id?: string;
          media_type: string;
          note_id: string;
          object_key: string;
          original_name: string;
          purge_after?: string | null;
          removed_at?: string | null;
          scan_state?: string;
          workspace_id: string;
        };
        Update: {
          byte_size?: number;
          checksum_sha256?: string;
          created_at?: string;
          id?: string;
          media_type?: string;
          note_id?: string;
          object_key?: string;
          original_name?: string;
          purge_after?: string | null;
          removed_at?: string | null;
          scan_state?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_attachments_note_id_workspace_id_fkey';
            columns: ['note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_attachments_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_goal_links: {
        Row: {
          created_at: string;
          goal_id: string;
          note_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          goal_id: string;
          note_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          goal_id?: string;
          note_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_goal_links_goal_id_workspace_id_fkey';
            columns: ['goal_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'goals';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_goal_links_note_id_workspace_id_fkey';
            columns: ['note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_goal_links_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_import_items: {
        Row: {
          ai_excluded: boolean;
          body_markdown: string;
          committed_at: string | null;
          content_hash: string;
          created_at: string;
          disposition: string;
          id: string;
          job_id: string;
          parent_source_path: string | null;
          reason: string | null;
          sort_order: number;
          source_cover_key: string | null;
          source_cover_position: number | null;
          source_favorited_at: string | null;
          source_icon_emoji: string | null;
          source_path: string;
          source_sort_key: number | null;
          target_note_id: string | null;
          title: string;
          workspace_id: string;
        };
        Insert: {
          ai_excluded?: boolean;
          body_markdown: string;
          committed_at?: string | null;
          content_hash: string;
          created_at?: string;
          disposition: string;
          id?: string;
          job_id: string;
          parent_source_path?: string | null;
          reason?: string | null;
          sort_order: number;
          source_cover_key?: string | null;
          source_cover_position?: number | null;
          source_favorited_at?: string | null;
          source_icon_emoji?: string | null;
          source_path: string;
          source_sort_key?: number | null;
          target_note_id?: string | null;
          title: string;
          workspace_id: string;
        };
        Update: {
          ai_excluded?: boolean;
          body_markdown?: string;
          committed_at?: string | null;
          content_hash?: string;
          created_at?: string;
          disposition?: string;
          id?: string;
          job_id?: string;
          parent_source_path?: string | null;
          reason?: string | null;
          sort_order?: number;
          source_cover_key?: string | null;
          source_cover_position?: number | null;
          source_favorited_at?: string | null;
          source_icon_emoji?: string | null;
          source_path?: string;
          source_sort_key?: number | null;
          target_note_id?: string | null;
          title?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_import_items_job_id_workspace_id_fkey';
            columns: ['job_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'note_import_jobs';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_import_items_target_note_id_workspace_id_fkey';
            columns: ['target_note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_import_items_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_import_jobs: {
        Row: {
          committed_count: number;
          completed_at: string | null;
          create_count: number;
          created_at: string;
          duplicate_count: number;
          id: string;
          source_name: string;
          source_type: string;
          status: string;
          total_count: number;
          unsupported_count: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          committed_count?: number;
          completed_at?: string | null;
          create_count?: number;
          created_at?: string;
          duplicate_count?: number;
          id?: string;
          source_name: string;
          source_type: string;
          status?: string;
          total_count: number;
          unsupported_count?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          committed_count?: number;
          completed_at?: string | null;
          create_count?: number;
          created_at?: string;
          duplicate_count?: number;
          id?: string;
          source_name?: string;
          source_type?: string;
          status?: string;
          total_count?: number;
          unsupported_count?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_import_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_links: {
        Row: {
          created_at: string;
          id: string;
          relation_type: string;
          source_note_id: string;
          target_note_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          relation_type?: string;
          source_note_id: string;
          target_note_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          relation_type?: string;
          source_note_id?: string;
          target_note_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_links_source_note_id_workspace_id_fkey';
            columns: ['source_note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_links_target_note_id_workspace_id_fkey';
            columns: ['target_note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_links_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_revisions: {
        Row: {
          author_user_id: string | null;
          body_markdown: string;
          created_at: string;
          id: string;
          note_id: string;
          operation_receipt_id: string | null;
          source_version: number;
          surface: string;
          title: string;
          workspace_id: string;
        };
        Insert: {
          author_user_id?: string | null;
          body_markdown: string;
          created_at?: string;
          id?: string;
          note_id: string;
          operation_receipt_id?: string | null;
          source_version: number;
          surface: string;
          title: string;
          workspace_id: string;
        };
        Update: {
          author_user_id?: string | null;
          body_markdown?: string;
          created_at?: string;
          id?: string;
          note_id?: string;
          operation_receipt_id?: string | null;
          source_version?: number;
          surface?: string;
          title?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_revisions_note_id_workspace_id_fkey';
            columns: ['note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_revisions_operation_receipt_id_fkey';
            columns: ['operation_receipt_id'];
            isOneToOne: false;
            referencedRelation: 'operation_receipts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'note_revisions_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      note_tags: {
        Row: {
          created_at: string;
          note_id: string;
          tag_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          note_id: string;
          tag_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          note_id?: string;
          tag_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'note_tags_note_id_workspace_id_fkey';
            columns: ['note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_tags_tag_id_workspace_id_fkey';
            columns: ['tag_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'tags';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'note_tags_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      notes: {
        Row: {
          ai_excluded: boolean;
          archived_at: string | null;
          body_markdown: string;
          cover_key: string | null;
          cover_position: number;
          created_at: string;
          favorited_at: string | null;
          icon_emoji: string | null;
          id: string;
          parent_note_id: string | null;
          purge_after: string | null;
          search_vector: unknown;
          sort_key: number;
          title: string;
          trashed_at: string | null;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          ai_excluded?: boolean;
          archived_at?: string | null;
          body_markdown?: string;
          cover_key?: string | null;
          cover_position?: number;
          created_at?: string;
          favorited_at?: string | null;
          icon_emoji?: string | null;
          id?: string;
          parent_note_id?: string | null;
          purge_after?: string | null;
          search_vector?: unknown;
          sort_key?: number;
          title: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          ai_excluded?: boolean;
          archived_at?: string | null;
          body_markdown?: string;
          cover_key?: string | null;
          cover_position?: number;
          created_at?: string;
          favorited_at?: string | null;
          icon_emoji?: string | null;
          id?: string;
          parent_note_id?: string | null;
          purge_after?: string | null;
          search_vector?: unknown;
          sort_key?: number;
          title?: string;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notes_parent_note_id_workspace_id_fkey';
            columns: ['parent_note_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'notes';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'notes_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_email_deliveries: {
        Row: {
          attempt_count: number;
          claimed_at: string;
          created_at: string;
          delivery_on: string;
          error_code: string | null;
          id: string;
          next_attempt_at: string;
          notification_count: number;
          provider_message_id: string | null;
          sent_at: string | null;
          status: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          attempt_count?: number;
          claimed_at?: string;
          created_at?: string;
          delivery_on: string;
          error_code?: string | null;
          id?: string;
          next_attempt_at?: string;
          notification_count: number;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          attempt_count?: number;
          claimed_at?: string;
          created_at?: string;
          delivery_on?: string;
          error_code?: string | null;
          id?: string;
          next_attempt_at?: string;
          notification_count?: number;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_email_deliveries_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          body: string;
          created_at: string;
          dedupe_key: string;
          dismissed_at: string | null;
          href: string;
          id: string;
          kind: string;
          read_at: string | null;
          title: string;
          updated_at: string;
          version: number;
          visible_at: string;
          workspace_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          dedupe_key: string;
          dismissed_at?: string | null;
          href: string;
          id?: string;
          kind: string;
          read_at?: string | null;
          title: string;
          updated_at?: string;
          version?: number;
          visible_at?: string;
          workspace_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          dedupe_key?: string;
          dismissed_at?: string | null;
          href?: string;
          id?: string;
          kind?: string;
          read_at?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
          visible_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      operation_before_images: {
        Row: {
          created_at: string;
          id: number;
          payload_json: Json;
          target_id: string | null;
          target_type: string;
          transaction_id: number;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          payload_json: Json;
          target_id?: string | null;
          target_type: string;
          transaction_id: number;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          payload_json?: Json;
          target_id?: string | null;
          target_type?: string;
          transaction_id?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operation_before_images_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      operation_contracts: {
        Row: {
          created_at: string;
          exposures: string[];
          operation_id: string;
          reversible: boolean;
          risk_class: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          exposures: string[];
          operation_id: string;
          reversible: boolean;
          risk_class: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          exposures?: string[];
          operation_id?: string;
          reversible?: boolean;
          risk_class?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      operation_receipts: {
        Row: {
          actor_type: string;
          actor_user_id: string;
          completed_at: string;
          created_at: string;
          id: string;
          idempotency_key: string;
          operation_id: string;
          operation_version: number;
          result_json: Json | null;
          reversed_at: string | null;
          reversed_by_receipt_id: string | null;
          reverses_receipt_id: string | null;
          risk_class: string;
          stable_error_code: string | null;
          status: string;
          surface: string;
          target_id: string | null;
          target_type: string | null;
          undo_payload_json: Json | null;
          workspace_id: string;
        };
        Insert: {
          actor_type?: string;
          actor_user_id: string;
          completed_at?: string;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          operation_id: string;
          operation_version?: number;
          result_json?: Json | null;
          reversed_at?: string | null;
          reversed_by_receipt_id?: string | null;
          reverses_receipt_id?: string | null;
          risk_class: string;
          stable_error_code?: string | null;
          status: string;
          surface: string;
          target_id?: string | null;
          target_type?: string | null;
          undo_payload_json?: Json | null;
          workspace_id: string;
        };
        Update: {
          actor_type?: string;
          actor_user_id?: string;
          completed_at?: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          operation_id?: string;
          operation_version?: number;
          result_json?: Json | null;
          reversed_at?: string | null;
          reversed_by_receipt_id?: string | null;
          reverses_receipt_id?: string | null;
          risk_class?: string;
          stable_error_code?: string | null;
          status?: string;
          surface?: string;
          target_id?: string | null;
          target_type?: string | null;
          undo_payload_json?: Json | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operation_receipts_reversed_by_fk';
            columns: ['reversed_by_receipt_id'];
            isOneToOne: false;
            referencedRelation: 'operation_receipts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'operation_receipts_reverses_fk';
            columns: ['reverses_receipt_id'];
            isOneToOne: false;
            referencedRelation: 'operation_receipts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'operation_receipts_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      operation_undo_support: {
        Row: {
          created_at: string;
          operation_id: string;
          strategy: string;
        };
        Insert: {
          created_at?: string;
          operation_id: string;
          strategy: string;
        };
        Update: {
          created_at?: string;
          operation_id?: string;
          strategy?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operation_undo_support_operation_id_fkey';
            columns: ['operation_id'];
            isOneToOne: true;
            referencedRelation: 'operation_contracts';
            referencedColumns: ['operation_id'];
          },
        ];
      };
      planning_horizons: {
        Row: {
          created_at: string;
          ends_on: string;
          id: string;
          kind: string;
          starts_on: string;
          timezone_snapshot: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          ends_on: string;
          id?: string;
          kind: string;
          starts_on: string;
          timezone_snapshot: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          id?: string;
          kind?: string;
          starts_on?: string;
          timezone_snapshot?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'planning_horizons_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      review_action_items: {
        Row: {
          action_id: string;
          action_status_snapshot: string;
          action_title_snapshot: string;
          action_version_snapshot: number;
          created_at: string;
          id: string;
          priority: boolean;
          reason: string | null;
          resolution: string;
          review_id: string;
          workspace_id: string;
        };
        Insert: {
          action_id: string;
          action_status_snapshot: string;
          action_title_snapshot: string;
          action_version_snapshot: number;
          created_at?: string;
          id?: string;
          priority?: boolean;
          reason?: string | null;
          resolution: string;
          review_id: string;
          workspace_id: string;
        };
        Update: {
          action_id?: string;
          action_status_snapshot?: string;
          action_title_snapshot?: string;
          action_version_snapshot?: number;
          created_at?: string;
          id?: string;
          priority?: boolean;
          reason?: string | null;
          resolution?: string;
          review_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'review_action_items_action_id_workspace_id_fkey';
            columns: ['action_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'actions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'review_action_items_review_id_workspace_id_fkey';
            columns: ['review_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'reviews';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'review_action_items_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      review_ai_proposals: {
        Row: {
          created_at: string;
          ends_on: string;
          id: string;
          kind: string;
          model_id: string;
          payload: Json;
          prompt_version: string;
          starts_on: string;
          status: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          ends_on: string;
          id?: string;
          kind: string;
          model_id: string;
          payload: Json;
          prompt_version: string;
          starts_on: string;
          status?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          id?: string;
          kind?: string;
          model_id?: string;
          payload?: Json;
          prompt_version?: string;
          starts_on?: string;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'review_ai_proposals_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      reviews: {
        Row: {
          completed_at: string | null;
          created_at: string;
          horizon_id: string;
          id: string;
          kind: string;
          reflection_markdown: string;
          status: string;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          horizon_id: string;
          id?: string;
          kind: string;
          reflection_markdown?: string;
          status: string;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          horizon_id?: string;
          id?: string;
          kind?: string;
          reflection_markdown?: string;
          status?: string;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reviews_horizon_id_workspace_id_fkey';
            columns: ['horizon_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'planning_horizons';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'reviews_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      tags: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          normalized_name: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          normalized_name: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          normalized_name?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tags_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      trash_batch_focus_items: {
        Row: {
          action_id: string;
          batch_id: string;
          focus_on: string;
          sort_order: number;
          workspace_id: string;
        };
        Insert: {
          action_id: string;
          batch_id: string;
          focus_on: string;
          sort_order: number;
          workspace_id: string;
        };
        Update: {
          action_id?: string;
          batch_id?: string;
          focus_on?: string;
          sort_order?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trash_batch_focus_items_action_id_workspace_id_fkey';
            columns: ['action_id', 'workspace_id'];
            isOneToOne: false;
            referencedRelation: 'actions';
            referencedColumns: ['id', 'workspace_id'];
          },
          {
            foreignKeyName: 'trash_batch_focus_items_batch_id_fkey';
            columns: ['batch_id'];
            isOneToOne: false;
            referencedRelation: 'trash_batches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trash_batch_focus_items_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      trash_batch_items: {
        Row: {
          batch_id: string;
          item_id: string;
          item_type: string;
          workspace_id: string;
        };
        Insert: {
          batch_id: string;
          item_id: string;
          item_type: string;
          workspace_id: string;
        };
        Update: {
          batch_id?: string;
          item_id?: string;
          item_type?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trash_batch_items_batch_id_fkey';
            columns: ['batch_id'];
            isOneToOne: false;
            referencedRelation: 'trash_batches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trash_batch_items_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      trash_batches: {
        Row: {
          created_at: string;
          emptied_at: string | null;
          id: string;
          restored_at: string | null;
          root_item_id: string;
          root_item_type: string;
          root_label: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          emptied_at?: string | null;
          id?: string;
          restored_at?: string | null;
          root_item_id: string;
          root_item_type: string;
          root_label: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          emptied_at?: string | null;
          id?: string;
          restored_at?: string | null;
          root_item_id?: string;
          root_item_type?: string;
          root_label?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trash_batches_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      visions: {
        Row: {
          archived_at: string | null;
          body_markdown: string;
          created_at: string;
          id: string;
          purge_after: string | null;
          trashed_at: string | null;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          body_markdown: string;
          created_at?: string;
          id?: string;
          purge_after?: string | null;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          body_markdown?: string;
          created_at?: string;
          id?: string;
          purge_after?: string | null;
          trashed_at?: string | null;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'visions_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspaces: {
        Row: {
          ai_enabled: boolean;
          ai_soft_budget_cents: number;
          coaching_intensity: string;
          created_at: string;
          email_reminders_enabled: boolean;
          id: string;
          in_app_notifications_enabled: boolean;
          name: string;
          onboarding_completed_at: string | null;
          owner_user_id: string;
          quiet_hours_end: string;
          quiet_hours_start: string;
          reminder_email_hour: number;
          timezone: string;
          updated_at: string;
          week_starts_on: number;
          weekly_review_day: number;
        };
        Insert: {
          ai_enabled?: boolean;
          ai_soft_budget_cents?: number;
          coaching_intensity?: string;
          created_at?: string;
          email_reminders_enabled?: boolean;
          id?: string;
          in_app_notifications_enabled?: boolean;
          name?: string;
          onboarding_completed_at?: string | null;
          owner_user_id: string;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          reminder_email_hour?: number;
          timezone?: string;
          updated_at?: string;
          week_starts_on?: number;
          weekly_review_day?: number;
        };
        Update: {
          ai_enabled?: boolean;
          ai_soft_budget_cents?: number;
          coaching_intensity?: string;
          created_at?: string;
          email_reminders_enabled?: boolean;
          id?: string;
          in_app_notifications_enabled?: boolean;
          name?: string;
          onboarding_completed_at?: string | null;
          owner_user_id?: string;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          reminder_email_hour?: number;
          timezone?: string;
          updated_at?: string;
          week_starts_on?: number;
          weekly_review_day?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_mcp_oauth_grant: {
        Args: {
          p_allowed_operations: string[];
          p_client_name: string;
          p_oauth_client_id: string;
        };
        Returns: string;
      };
      authenticate_mcp_oauth_grant: {
        Args: never;
        Returns: {
          allowed_operations: string[];
          grant_id: string;
          owner_user_id: string;
          workspace_id: string;
        }[];
      };
      authenticate_mcp_token: {
        Args: { p_token_hash: string };
        Returns: {
          allowed_operations: string[];
          owner_user_id: string;
          token_id: string;
          workspace_id: string;
        }[];
      };
      build_mcp_workspace_snapshot: {
        Args: { p_workspace_id: string };
        Returns: Json;
      };
      build_mcp_workspace_snapshot_action_template_base: {
        Args: { p_workspace_id: string };
        Returns: Json;
      };
      build_mcp_workspace_snapshot_conversation_base: {
        Args: { p_workspace_id: string };
        Returns: Json;
      };
      build_mcp_workspace_snapshot_notification_base: {
        Args: { p_workspace_id: string };
        Returns: Json;
      };
      capture_proposal_batch_json: {
        Args: { p_batch_id: string };
        Returns: Json;
      };
      capture_proposal_item_json: { Args: { p_item_id: string }; Returns: Json };
      claim_beta_invite: {
        Args: { p_email: string; p_token_hash: string };
        Returns: string;
      };
      claim_notification_email_batch: {
        Args: { p_limit?: number };
        Returns: {
          delivery_id: string;
          delivery_on: string;
          email: string;
          notification_count: number;
          timezone: string;
          user_id: string;
          workspace_id: string;
        }[];
      };
      consume_ai_quota: { Args: { p_operation: string }; Returns: boolean };
      consume_ai_quota_status:
        | { Args: { p_operation: string }; Returns: string }
        | {
            Args: { p_operation: string; p_request_id: string };
            Returns: string;
          };
      consume_mcp_oauth_quota: {
        Args: { p_grant_id: string };
        Returns: boolean;
      };
      consume_review_analysis_quota: {
        Args: { p_request_id: string };
        Returns: string;
      };
      create_mcp_access_token: {
        Args: {
          p_allowed_operations: string[];
          p_expires_at: string;
          p_name: string;
          p_token_hash: string;
        };
        Returns: string;
      };
      dismiss_assistant_proposal: {
        Args: { p_proposal_id: string };
        Returns: undefined;
      };
      dispatch_trusted_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      dispatch_trusted_operation_action_template_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      dispatch_trusted_operation_capture_action_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      dispatch_trusted_operation_capture_proposal_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      dispatch_trusted_operation_conversation_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      dispatch_trusted_operation_note_appearance_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      dispatch_trusted_operation_notification_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_account_deletion_schedule_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_account_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_action_template_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_ai_budget_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_assistant_proposal: {
        Args: { p_proposal_id: string };
        Returns: Json;
      };
      execute_assistant_proposal_conversation_base: {
        Args: { p_proposal_id: string };
        Returns: Json;
      };
      execute_capture_action_filing_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_capture_action_filing_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_capture_filing_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_capture_proposal_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_conversation_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_daily_execution_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_daily_focus_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_guided_onboarding_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_guided_onboarding_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_knowledge_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface?: string;
        };
        Returns: Json;
      };
      execute_mcp_oauth_operation: {
        Args: {
          p_grant_id: string;
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
        };
        Returns: Json;
      };
      execute_mcp_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_token_id: string;
        };
        Returns: Json;
      };
      execute_memory_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_note_appearance_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface?: string;
        };
        Returns: Json;
      };
      execute_note_import_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_note_import_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_note_metadata_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_note_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface?: string;
        };
        Returns: Json;
      };
      execute_note_relation_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_notification_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_account_deletion_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_action_template_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_capture_action_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_capture_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_capture_proposal_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_conversation_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_focus_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_metadata_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_note_import_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_notification_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_period_review_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_planning_archive_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_planning_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_trash_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_trash_restore_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_vision_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_weekly_review_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_operation_undo_workspace_base: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_period_review_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_period_review_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_plan_edit_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_planner_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface?: string;
        };
        Returns: Json;
      };
      execute_planning_archive_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_planning_snapshot_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_review_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface?: string;
        };
        Returns: Json;
      };
      execute_trash_move_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_trash_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_trash_restore_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_ui_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
        };
        Returns: Json;
      };
      execute_vision_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_weekly_review_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_workspace_operation: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      execute_workspace_settings_undo: {
        Args: {
          p_idempotency_key: string;
          p_input: Json;
          p_operation_id: string;
          p_surface: string;
        };
        Returns: Json;
      };
      generate_workspace_notifications: {
        Args: { p_workspace_id: string };
        Returns: number;
      };
      manage_conversation: {
        Args: { p_action: string; p_conversation_id: string; p_title?: string };
        Returns: undefined;
      };
      next_monthly_occurrence: {
        Args: { p_anchor_day: number; p_occurrence_on: string };
        Returns: string;
      };
      persist_capture_proposal_analysis: {
        Args: {
          p_analysis: Json;
          p_capture_id: string;
          p_model_id: string;
          p_owner_user_id: string;
          p_prompt_version: string;
        };
        Returns: string;
      };
      persist_capture_proposal_analysis_job: {
        Args: {
          p_analysis: Json;
          p_capture_id: string;
          p_job_id: string;
          p_model_id: string;
          p_owner_user_id: string;
          p_prompt_version: string;
        };
        Returns: string;
      };
      persist_review_ai_proposal: {
        Args: {
          p_ends_on: string;
          p_kind: string;
          p_model_id: string;
          p_owner_user_id: string;
          p_payload: Json;
          p_prompt_version: string;
          p_starts_on: string;
        };
        Returns: string;
      };
      persist_review_ai_proposal_job: {
        Args: {
          p_ends_on: string;
          p_job_id: string;
          p_kind: string;
          p_model_id: string;
          p_owner_user_id: string;
          p_payload: Json;
          p_prompt_version: string;
          p_starts_on: string;
        };
        Returns: string;
      };
      raise_if_period_already_reviewed: {
        Args: { p_horizon_id: string; p_kind: string; p_workspace_id: string };
        Returns: undefined;
      };
      read_mcp_oauth_workspace_snapshot: {
        Args: { p_grant_id: string };
        Returns: Json;
      };
      read_mcp_workspace_snapshot: {
        Args: { p_token_id: string };
        Returns: Json;
      };
      record_ai_usage: {
        Args: {
          p_audio_seconds: number;
          p_error_code: string;
          p_estimated_cost_micros: number;
          p_input_tokens: number;
          p_latency_ms: number;
          p_model_id: string;
          p_operation: string;
          p_outcome: string;
          p_output_tokens: number;
          p_pricing_version: string;
          p_provider: string;
          p_provider_role: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      record_ai_usage_review_base: {
        Args: {
          p_audio_seconds: number;
          p_error_code: string;
          p_estimated_cost_micros: number;
          p_input_tokens: number;
          p_latency_ms: number;
          p_model_id: string;
          p_operation: string;
          p_outcome: string;
          p_output_tokens: number;
          p_pricing_version: string;
          p_provider: string;
          p_provider_role: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      record_assistant_turn:
        | {
            Args: {
              p_assistant_content: string;
              p_conversation_id: string;
              p_model_id: string;
              p_prompt_version: string;
              p_proposal: Json;
              p_route: string;
              p_sources: Json;
              p_user_content: string;
            };
            Returns: Json;
          }
        | {
            Args: {
              p_assistant_content: string;
              p_claims: Json;
              p_conversation_id: string;
              p_model_id: string;
              p_prompt_version: string;
              p_proposal: Json;
              p_route: string;
              p_sources: Json;
              p_user_content: string;
            };
            Returns: Json;
          };
      record_assistant_turn_conversation_base: {
        Args: {
          p_assistant_content: string;
          p_conversation_id: string;
          p_model_id: string;
          p_prompt_version: string;
          p_proposal: Json;
          p_route: string;
          p_sources: Json;
          p_user_content: string;
        };
        Returns: Json;
      };
      refresh_all_workspace_notifications: { Args: never; Returns: number };
      release_ai_quota_reservation: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      release_beta_invite: { Args: { p_invite_id: string }; Returns: undefined };
      review_week_eligible_actions: {
        Args: { p_ends_on: string; p_starts_on: string; p_workspace_id: string };
        Returns: {
          action_id: string;
          horizon_kind: string;
        }[];
      };
      revoke_mcp_access_token: {
        Args: { p_token_id: string };
        Returns: undefined;
      };
      revoke_mcp_oauth_grant: {
        Args: { p_oauth_client_id: string };
        Returns: undefined;
      };
      search_conversations: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_query?: string;
          p_status?: string;
        };
        Returns: {
          archived_at: string;
          id: string;
          last_message_at: string;
          message_count: number;
          status: string;
          title: string;
          updated_at: string;
          version: number;
        }[];
      };
      trash_item_snapshot: {
        Args: { p_item_id: string; p_item_type: string; p_workspace_id: string };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

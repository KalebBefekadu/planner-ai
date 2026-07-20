export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type GoalStatus = 'pending' | 'in_progress' | 'completed'

export interface Database {
  public: {
    Tables: {
      transcripts: {
        Row: {
          id: string
          user_id: string
          raw_text: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          raw_text: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          raw_text?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      visions: {
        Row: {
          id: string
          user_id: string
          content: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          content: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          content?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      yearly_goals: {
        Row: {
          id: string
          user_id: string
          vision_id: string
          content: string
          status: GoalStatus
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          vision_id: string
          content: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          vision_id?: string
          content?: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      quarterly_goals: {
        Row: {
          id: string
          user_id: string
          yearly_id: string
          content: string
          status: GoalStatus
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          yearly_id: string
          content: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          yearly_id?: string
          content?: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      monthly_tasks: {
        Row: {
          id: string
          user_id: string
          quarterly_id: string
          content: string
          status: GoalStatus
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          quarterly_id: string
          content: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          quarterly_id?: string
          content?: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      weekly_actions: {
        Row: {
          id: string
          user_id: string
          monthly_id: string
          content: string
          status: GoalStatus
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          monthly_id: string
          content: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          monthly_id?: string
          content?: string
          status?: GoalStatus
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      goal_status: GoalStatus
    }
  }
}

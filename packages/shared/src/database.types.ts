export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_unlocks: {
        Row: {
          expires_at: string | null
          feature: Database["public"]["Enums"]["unlock_feature"]
          id: string
          student_id: string
          unlocked_at: string
        }
        Insert: {
          expires_at?: string | null
          feature: Database["public"]["Enums"]["unlock_feature"]
          id?: string
          student_id: string
          unlocked_at?: string
        }
        Update: {
          expires_at?: string | null
          feature?: Database["public"]["Enums"]["unlock_feature"]
          id?: string
          student_id?: string
          unlocked_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_unlocks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          generated_at: string
          id: string
          reason: string | null
          recommended_hours: number
          student_id: string
          subject: Database["public"]["Enums"]["subject_code"]
          week_start: string
        }
        Insert: {
          generated_at?: string
          id?: string
          reason?: string | null
          recommended_hours: number
          student_id: string
          subject: Database["public"]["Enums"]["subject_code"]
          week_start: string
        }
        Update: {
          generated_at?: string
          id?: string
          reason?: string | null
          recommended_hours?: number
          student_id?: string
          subject?: Database["public"]["Enums"]["subject_code"]
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoices: {
        Row: {
          amount: number
          id: string
          issued_at: string
          paid_at: string | null
          period: string
          status: string
          student_count: number
          teacher_id: string
        }
        Insert: {
          amount: number
          id?: string
          issued_at?: string
          paid_at?: string | null
          period: string
          status?: string
          student_count: number
          teacher_id: string
        }
        Update: {
          amount?: number
          id?: string
          issued_at?: string
          paid_at?: string | null
          period?: string
          status?: string
          student_count?: number
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          activated_at: string | null
          created_at: string
          id: string
          invite_code: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["connection_status"]
          student_id: string
          teacher_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          id?: string
          invite_code?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          student_id: string
          teacher_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          id?: string
          invite_code?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_invite_code_fkey"
            columns: ["invite_code"]
            isOneToOne: false
            referencedRelation: "invite_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "connections_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disclosure_settings: {
        Row: {
          connection_id: string
          share_focus_data: boolean
          share_homework_photos: boolean
          share_study_time: boolean
          updated_at: string
        }
        Insert: {
          connection_id: string
          share_focus_data?: boolean
          share_homework_photos?: boolean
          share_study_time?: boolean
          updated_at?: string
        }
        Update: {
          connection_id?: string
          share_focus_data?: boolean
          share_homework_photos?: boolean
          share_study_time?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disclosure_settings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_checks: {
        Row: {
          checked_at: string
          drowsy: boolean
          id: string
          session_id: string
        }
        Insert: {
          checked_at?: string
          drowsy?: boolean
          id?: string
          session_id: string
        }
        Update: {
          checked_at?: string
          drowsy?: boolean
          id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_checks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_checks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_teacher_study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          ai_confidence: number | null
          ai_reason: string | null
          ai_verdict: Database["public"]["Enums"]["submission_verdict"] | null
          created_at: string
          id: string
          photo_paths: string[]
          resubmit_requested: boolean
          student_id: string
          submitted_at: string
          teacher_comment: string | null
          teacher_status: Database["public"]["Enums"]["review_status"]
          todo_id: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_reason?: string | null
          ai_verdict?: Database["public"]["Enums"]["submission_verdict"] | null
          created_at?: string
          id?: string
          photo_paths?: string[]
          resubmit_requested?: boolean
          student_id: string
          submitted_at?: string
          teacher_comment?: string | null
          teacher_status?: Database["public"]["Enums"]["review_status"]
          todo_id: string
        }
        Update: {
          ai_confidence?: number | null
          ai_reason?: string | null
          ai_verdict?: Database["public"]["Enums"]["submission_verdict"] | null
          created_at?: string
          id?: string
          photo_paths?: string[]
          resubmit_requested?: boolean
          student_id?: string
          submitted_at?: string
          teacher_comment?: string | null
          teacher_status?: Database["public"]["Enums"]["review_status"]
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          teacher_id: string
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          teacher_id: string
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          teacher_id?: string
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_codes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_codes_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_fees: {
        Row: {
          amount: number
          id: string
          memo: string | null
          paid: boolean
          paid_at: string | null
          period: string
          student_id: string
          teacher_id: string
        }
        Insert: {
          amount: number
          id?: string
          memo?: string | null
          paid?: boolean
          paid_at?: string | null
          period: string
          student_id: string
          teacher_id: string
        }
        Update: {
          amount?: number
          id?: string
          memo?: string | null
          paid?: boolean
          paid_at?: string | null
          period?: string
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_fees_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_fees_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          payload: Json | null
          read: boolean
          title: string
          type: Database["public"]["Enums"]["notif_type"]
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          read?: boolean
          title: string
          type: Database["public"]["Enums"]["notif_type"]
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notif_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      per_student_settings: {
        Row: {
          ai_check_subjects: Database["public"]["Enums"]["subject_code"][]
          connection_id: string
          report_cycle: string
          updated_at: string
        }
        Insert: {
          ai_check_subjects?: Database["public"]["Enums"]["subject_code"][]
          connection_id: string
          report_cycle?: string
          updated_at?: string
        }
        Update: {
          ai_check_subjects?: Database["public"]["Enums"]["subject_code"][]
          connection_id?: string
          report_cycle?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "per_student_settings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          birth_date: string | null
          created_at: string
          grade: string | null
          id: string
          name: string
          onboarded: boolean
          role: Database["public"]["Enums"]["user_role"]
          subjects: Database["public"]["Enums"]["subject_code"][] | null
          target_univ: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          created_at?: string
          grade?: string | null
          id: string
          name: string
          onboarded?: boolean
          role: Database["public"]["Enums"]["user_role"]
          subjects?: Database["public"]["Enums"]["subject_code"][] | null
          target_univ?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          created_at?: string
          grade?: string | null
          id?: string
          name?: string
          onboarded?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          subjects?: Database["public"]["Enums"]["subject_code"][] | null
          target_univ?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_views: {
        Row: {
          id: string
          report_id: string
          viewed_at: string
        }
        Insert: {
          id?: string
          report_id: string
          viewed_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_views_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          ai_draft: string | null
          created_at: string
          data: Json
          id: string
          included_subjects: Database["public"]["Enums"]["subject_code"][]
          period_end: string
          period_start: string
          sent_at: string | null
          share_expires_at: string | null
          share_token: string | null
          status: Database["public"]["Enums"]["report_status"]
          student_id: string
          teacher_comment: string | null
          teacher_id: string | null
          type: Database["public"]["Enums"]["report_type"]
        }
        Insert: {
          ai_draft?: string | null
          created_at?: string
          data?: Json
          id?: string
          included_subjects?: Database["public"]["Enums"]["subject_code"][]
          period_end: string
          period_start: string
          sent_at?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          student_id: string
          teacher_comment?: string | null
          teacher_id?: string | null
          type: Database["public"]["Enums"]["report_type"]
        }
        Update: {
          ai_draft?: string | null
          created_at?: string
          data?: Json
          id?: string
          included_subjects?: Database["public"]["Enums"]["subject_code"][]
          period_end?: string
          period_start?: string
          sent_at?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          student_id?: string
          teacher_comment?: string | null
          teacher_id?: string | null
          type?: Database["public"]["Enums"]["report_type"]
        }
        Relationships: [
          {
            foreignKeyName: "reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_subscriptions: {
        Row: {
          expires_at: string | null
          provider: Database["public"]["Enums"]["sub_provider"]
          status: Database["public"]["Enums"]["sub_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          expires_at?: string | null
          provider?: Database["public"]["Enums"]["sub_provider"]
          status?: Database["public"]["Enums"]["sub_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          expires_at?: string | null
          provider?: Database["public"]["Enums"]["sub_provider"]
          status?: Database["public"]["Enums"]["sub_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      study_sessions: {
        Row: {
          check_total: number | null
          created_at: string
          drowsy_count: number | null
          duration_sec: number
          ended_at: string | null
          focus_mode: boolean
          focus_score: number | null
          id: string
          started_at: string
          student_id: string
          subject: Database["public"]["Enums"]["subject_code"] | null
        }
        Insert: {
          check_total?: number | null
          created_at?: string
          drowsy_count?: number | null
          duration_sec?: number
          ended_at?: string | null
          focus_mode?: boolean
          focus_score?: number | null
          id?: string
          started_at: string
          student_id: string
          subject?: Database["public"]["Enums"]["subject_code"] | null
        }
        Update: {
          check_total?: number | null
          created_at?: string
          drowsy_count?: number | null
          duration_sec?: number
          ended_at?: string | null
          focus_mode?: boolean
          focus_score?: number | null
          id?: string
          started_at?: string
          student_id?: string
          subject?: Database["public"]["Enums"]["subject_code"] | null
        }
        Relationships: [
          {
            foreignKeyName: "study_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_subscriptions: {
        Row: {
          current_period_end: string | null
          payment_method_last4: string | null
          provider: Database["public"]["Enums"]["sub_provider"]
          status: Database["public"]["Enums"]["sub_status"]
          stripe_customer_id: string | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          current_period_end?: string | null
          payment_method_last4?: string | null
          provider?: Database["public"]["Enums"]["sub_provider"]
          status?: Database["public"]["Enums"]["sub_status"]
          stripe_customer_id?: string | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          current_period_end?: string | null
          payment_method_last4?: string | null
          provider?: Database["public"]["Enums"]["sub_provider"]
          status?: Database["public"]["Enums"]["sub_status"]
          stripe_customer_id?: string | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_subscriptions_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_blocks: {
        Row: {
          day_of_week: number
          end_min: number
          id: string
          label: string | null
          start_min: number
          student_id: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          day_of_week: number
          end_min: number
          id?: string
          label?: string | null
          start_min: number
          student_id: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          day_of_week?: number
          end_min?: number
          id?: string
          label?: string | null
          start_min?: number
          student_id?: string
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "timetable_blocks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      todos: {
        Row: {
          ai_check_enabled: boolean
          connection_id: string | null
          created_at: string
          created_by: string
          due_date: string | null
          id: string
          locked: boolean
          source: Database["public"]["Enums"]["todo_source"]
          status: Database["public"]["Enums"]["todo_status"]
          student_id: string
          subject: Database["public"]["Enums"]["subject_code"] | null
          title: string
        }
        Insert: {
          ai_check_enabled?: boolean
          connection_id?: string | null
          created_at?: string
          created_by: string
          due_date?: string | null
          id?: string
          locked?: boolean
          source?: Database["public"]["Enums"]["todo_source"]
          status?: Database["public"]["Enums"]["todo_status"]
          student_id: string
          subject?: Database["public"]["Enums"]["subject_code"] | null
          title: string
        }
        Update: {
          ai_check_enabled?: boolean
          connection_id?: string | null
          created_at?: string
          created_by?: string
          due_date?: string | null
          id?: string
          locked?: boolean
          source?: Database["public"]["Enums"]["todo_source"]
          status?: Database["public"]["Enums"]["todo_status"]
          student_id?: string
          subject?: Database["public"]["Enums"]["subject_code"] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "todos_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_teacher_study_sessions: {
        Row: {
          check_total: number | null
          created_at: string | null
          drowsy_count: number | null
          duration_sec: number | null
          ended_at: string | null
          focus_mode: boolean | null
          focus_score: number | null
          id: string | null
          started_at: string | null
          student_id: string | null
          subject: Database["public"]["Enums"]["subject_code"] | null
          teacher_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connections_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_role_is: {
        Args: { p: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      is_connected_active: {
        Args: { p_student: string; p_teacher: string }
        Returns: boolean
      }
    }
    Enums: {
      activity_type: "school" | "academy" | "self" | "class"
      connection_status: "pending" | "active" | "rejected" | "disconnected"
      notif_type:
        | "reminder"
        | "homework"
        | "resubmit"
        | "check_done"
        | "report"
        | "connection"
        | "billing"
        | "cheer"
        | "system"
      report_status: "draft" | "sent"
      report_type: "weekly" | "lesson"
      review_status: "pending" | "confirmed" | "rejected"
      sub_provider: "iap" | "stripe"
      sub_status: "none" | "active" | "past_due" | "canceled" | "paused"
      subject_code: "math" | "english" | "korean" | "science" | "social" | "etc"
      submission_verdict: "pass" | "insufficient" | "ambiguous"
      todo_source: "self" | "teacher"
      todo_status: "todo" | "done"
      unlock_feature: "report" | "ai_check" | "ai_rec"
      user_role: "student" | "teacher"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: ["school", "academy", "self", "class"],
      connection_status: ["pending", "active", "rejected", "disconnected"],
      notif_type: [
        "reminder",
        "homework",
        "resubmit",
        "check_done",
        "report",
        "connection",
        "billing",
        "cheer",
        "system",
      ],
      report_status: ["draft", "sent"],
      report_type: ["weekly", "lesson"],
      review_status: ["pending", "confirmed", "rejected"],
      sub_provider: ["iap", "stripe"],
      sub_status: ["none", "active", "past_due", "canceled", "paused"],
      subject_code: ["math", "english", "korean", "science", "social", "etc"],
      submission_verdict: ["pass", "insufficient", "ambiguous"],
      todo_source: ["self", "teacher"],
      todo_status: ["todo", "done"],
      unlock_feature: ["report", "ai_check", "ai_rec"],
      user_role: ["student", "teacher"],
    },
  },
} as const

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<{
        id: string;
        role: Database["public"]["Enums"]["user_role"];
        name: string;
        avatar_url: string | null;
        grade: string | null;
        target_univ: string | null;
        birth_date: string | null;
        subjects: Database["public"]["Enums"]["subject_code"][] | null;
        bio: string | null;
        onboarded: boolean;
        created_at: string;
        updated_at: string;
      }>;
      invite_codes: Table<{
        code: string;
        teacher_id: string;
        expires_at: string | null;
        used_by: string | null;
        created_at: string;
      }>;
      connections: Table<{
        id: string;
        teacher_id: string;
        student_id: string;
        status: Database["public"]["Enums"]["connection_status"];
        invite_code: string | null;
        requested_by: string | null;
        created_at: string;
        activated_at: string | null;
      }>;
      disclosure_settings: Table<{
        connection_id: string;
        share_study_time: boolean;
        share_homework_photos: boolean;
        share_focus_data: boolean;
        updated_at: string;
      }>;
      per_student_settings: Table<{
        connection_id: string;
        ai_check_subjects: Database["public"]["Enums"]["subject_code"][];
        report_cycle: string;
        updated_at: string;
      }>;
      todos: Table<{
        id: string;
        student_id: string;
        connection_id: string | null;
        title: string;
        subject: Database["public"]["Enums"]["subject_code"] | null;
        source: Database["public"]["Enums"]["todo_source"];
        ai_check_enabled: boolean;
        locked: boolean;
        due_date: string | null;
        status: Database["public"]["Enums"]["todo_status"];
        created_by: string;
        created_at: string;
      }>;
      homework_submissions: Table<{
        id: string;
        todo_id: string;
        student_id: string;
        photo_paths: string[];
        submitted_at: string;
        ai_verdict:
          | Database["public"]["Enums"]["submission_verdict"]
          | null;
        ai_confidence: number | null;
        ai_reason: string | null;
        teacher_status: Database["public"]["Enums"]["review_status"];
        teacher_comment: string | null;
        resubmit_requested: boolean;
        created_at: string;
      }>;
      study_sessions: Table<{
        id: string;
        student_id: string;
        subject: Database["public"]["Enums"]["subject_code"] | null;
        started_at: string;
        ended_at: string | null;
        duration_sec: number;
        focus_mode: boolean;
        focus_score: number | null;
        drowsy_count: number | null;
        check_total: number | null;
        created_at: string;
      }>;
      focus_checks: Table<{
        id: string;
        session_id: string;
        checked_at: string;
        drowsy: boolean;
      }>;
      timetable_blocks: Table<{
        id: string;
        student_id: string;
        type: Database["public"]["Enums"]["activity_type"];
        day_of_week: number;
        start_min: number;
        end_min: number;
        label: string | null;
      }>;
      ai_recommendations: Table<{
        id: string;
        student_id: string;
        week_start: string;
        subject: Database["public"]["Enums"]["subject_code"];
        recommended_hours: number;
        reason: string | null;
        generated_at: string;
      }>;
      reports: Table<{
        id: string;
        student_id: string;
        teacher_id: string | null;
        type: Database["public"]["Enums"]["report_type"];
        period_start: string;
        period_end: string;
        data: Json;
        ai_draft: string | null;
        teacher_comment: string | null;
        included_subjects: Database["public"]["Enums"]["subject_code"][];
        status: Database["public"]["Enums"]["report_status"];
        share_token: string | null;
        share_expires_at: string | null;
        sent_at: string | null;
        created_at: string;
      }>;
      report_views: Table<{
        id: string;
        report_id: string;
        viewed_at: string;
      }>;
      lesson_fees: Table<{
        id: string;
        teacher_id: string;
        student_id: string;
        period: string;
        amount: number;
        paid: boolean;
        paid_at: string | null;
        memo: string | null;
      }>;
      student_subscriptions: Table<{
        student_id: string;
        status: Database["public"]["Enums"]["sub_status"];
        provider: Database["public"]["Enums"]["sub_provider"];
        expires_at: string | null;
        updated_at: string;
      }>;
      teacher_subscriptions: Table<{
        teacher_id: string;
        status: Database["public"]["Enums"]["sub_status"];
        provider: Database["public"]["Enums"]["sub_provider"];
        stripe_customer_id: string | null;
        payment_method_last4: string | null;
        current_period_end: string | null;
        updated_at: string;
      }>;
      billing_invoices: Table<{
        id: string;
        teacher_id: string;
        period: string;
        student_count: number;
        amount: number;
        status: string;
        issued_at: string;
        paid_at: string | null;
      }>;
      ad_unlocks: Table<{
        id: string;
        student_id: string;
        feature: Database["public"]["Enums"]["unlock_feature"];
        unlocked_at: string;
        expires_at: string | null;
      }>;
      notifications: Table<{
        id: string;
        user_id: string;
        type: Database["public"]["Enums"]["notif_type"];
        title: string;
        body: string | null;
        payload: Json | null;
        read: boolean;
        created_at: string;
      }>;
      push_tokens: Table<{
        id: string;
        user_id: string;
        token: string;
        platform: string;
        created_at: string;
      }>;
    };
    Views: {
      v_teacher_study_sessions: {
        Row: Database["public"]["Tables"]["study_sessions"]["Row"] & {
          teacher_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Functions: {
      current_role_is: {
        Args: { p: Database["public"]["Enums"]["user_role"] };
        Returns: boolean;
      };
      is_connected_active: {
        Args: { p_teacher: string; p_student: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: "student" | "teacher";
      connection_status: "pending" | "active" | "rejected" | "disconnected";
      subject_code: "math" | "english" | "korean" | "science" | "social" | "etc";
      todo_source: "self" | "teacher";
      todo_status: "todo" | "done";
      submission_verdict: "pass" | "insufficient" | "ambiguous";
      review_status: "pending" | "confirmed" | "rejected";
      report_type: "weekly" | "lesson";
      report_status: "draft" | "sent";
      sub_status: "none" | "active" | "past_due" | "canceled" | "paused";
      sub_provider: "iap" | "stripe";
      activity_type: "school" | "academy" | "self" | "class";
      notif_type:
        | "reminder"
        | "homework"
        | "resubmit"
        | "check_done"
        | "report"
        | "connection"
        | "billing"
        | "cheer"
        | "system";
      unlock_feature: "report" | "ai_check" | "ai_rec";
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<
  PublicTableName extends keyof Database["public"]["Tables"]
> = Database["public"]["Tables"][PublicTableName]["Row"];

export type Enums<
  PublicEnumName extends keyof Database["public"]["Enums"]
> = Database["public"]["Enums"][PublicEnumName];

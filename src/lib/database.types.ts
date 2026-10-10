export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      app_owner: {
        Row: {
          singleton: boolean;
          user_id: string;
        };
        Insert: {
          singleton?: boolean;
          user_id: string;
        };
        Update: {
          singleton?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      daily_entries: {
        Row: {
          created_at: string;
          data: Json;
          logical_date: string;
          revision: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          data?: Json;
          logical_date: string;
          revision?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          logical_date?: string;
          revision?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      journal_images: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          logical_date: string;
          position: number;
          revision: number;
          storage_path: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          logical_date: string;
          position: number;
          revision?: number;
          storage_path: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          logical_date?: string;
          position?: number;
          revision?: number;
          storage_path?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "journal_images_user_id_logical_date_fkey";
            columns: ["user_id", "logical_date"];
            isOneToOne: false;
            referencedRelation: "daily_entries";
            referencedColumns: ["user_id", "logical_date"];
          },
        ];
      };
      operation_receipts: {
        Row: {
          created_at: string;
          entity_key: string;
          operation_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entity_key: string;
          operation_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          entity_key?: string;
          operation_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      task_events: {
        Row: {
          event_type: string;
          id: string;
          logical_date: string;
          occurred_at: string;
          operation_id: string;
          parent_id: string | null;
          task_id: string;
          timezone: string;
          title: string;
          topic: string;
          user_id: string;
        };
        Insert: {
          event_type: string;
          id: string;
          logical_date: string;
          occurred_at: string;
          operation_id: string;
          parent_id?: string | null;
          task_id: string;
          timezone: string;
          title: string;
          topic: string;
          user_id: string;
        };
        Update: {
          event_type?: string;
          id?: string;
          logical_date?: string;
          occurred_at?: string;
          operation_id?: string;
          parent_id?: string | null;
          task_id?: string;
          timezone?: string;
          title?: string;
          topic?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_events_user_id_task_id_topic_fkey";
            columns: ["user_id", "task_id", "topic"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["user_id", "id", "topic"];
          },
        ];
      };
      tasks: {
        Row: {
          completed_at: string | null;
          created_at: string;
          deleted_at: string | null;
          id: string;
          parent_id: string | null;
          revision: number;
          title: string;
          topic: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at: string;
          deleted_at?: string | null;
          id: string;
          parent_id?: string | null;
          revision?: number;
          title: string;
          topic: string;
          updated_at: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          parent_id?: string | null;
          revision?: number;
          title?: string;
          topic?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_user_id_parent_id_topic_fkey";
            columns: ["user_id", "parent_id", "topic"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["user_id", "id", "topic"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_entry_patch: {
        Args: {
          p_date: string;
          p_operation: string;
          p_patch: Json;
          p_timezone: string;
        };
        Returns: Json;
      };
      apply_image_operation: {
        Args: {
          p_date: string;
          p_delete: boolean;
          p_image: string;
          p_operation: string;
          p_position: number;
          p_timezone: string;
        };
        Returns: Json;
      };
      apply_task_operation: {
        Args: { p_command: Json; p_operation: string };
        Returns: Json;
      };
      check_entry_access: {
        Args: { p_date: string; p_timezone: string };
        Returns: undefined;
      };
      valid_daily_data: { Args: { value: Json }; Returns: boolean };
      valid_daily_data_v1: { Args: { value: Json }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

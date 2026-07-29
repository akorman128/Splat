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
      attachments: {
        Row: {
          byte_size: number
          conversation_id: string
          created_at: string
          est_tokens: number
          extract_error: string | null
          extract_status: string
          extracted_text: string | null
          filename: string
          id: string
          image_height: number | null
          image_width: number | null
          kind: string
          mime_type: string
          node_id: string | null
          storage_path: string
          truncated: boolean
          user_id: string
        }
        Insert: {
          byte_size: number
          conversation_id: string
          created_at?: string
          est_tokens?: number
          extract_error?: string | null
          extract_status?: string
          extracted_text?: string | null
          filename: string
          id?: string
          image_height?: number | null
          image_width?: number | null
          kind: string
          mime_type: string
          node_id?: string | null
          storage_path: string
          truncated?: boolean
          user_id?: string
        }
        Update: {
          byte_size?: number
          conversation_id?: string
          created_at?: string
          est_tokens?: number
          extract_error?: string | null
          extract_status?: string
          extracted_text?: string | null
          filename?: string
          id?: string
          image_height?: number | null
          image_width?: number | null
          kind?: string
          mime_type?: string
          node_id?: string | null
          storage_path?: string
          truncated?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      context_edges: {
        Row: {
          id: string
          node_id: string
          position: number
          source_node_id: string
        }
        Insert: {
          id?: string
          node_id: string
          position: number
          source_node_id: string
        }
        Update: {
          id?: string
          node_id?: string
          position?: number
          source_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_edges_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_edges_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          share_token: string | null
          shared_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          share_token?: string | null
          shared_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          share_token?: string | null
          shared_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      node_attachments: {
        Row: {
          attachment_id: string | null
          filename: string
          id: string
          kind: string
          mime_type: string
          node_id: string
          position: number
        }
        Insert: {
          attachment_id?: string | null
          filename: string
          id?: string
          kind: string
          mime_type: string
          node_id: string
          position: number
        }
        Update: {
          attachment_id?: string | null
          filename?: string
          id?: string
          kind?: string
          mime_type?: string
          node_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "node_attachments_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_attachments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      node_skills: {
        Row: {
          id: string
          instructions: string
          name: string
          node_id: string
          position: number
          skill_id: string | null
        }
        Insert: {
          id?: string
          instructions: string
          name: string
          node_id: string
          position: number
          skill_id?: string | null
        }
        Update: {
          id?: string
          instructions?: string
          name?: string
          node_id?: string
          position?: number
          skill_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "node_skills_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          canvas_h: number
          canvas_w: number
          canvas_x: number
          canvas_y: number
          completion_tokens: number | null
          conversation_id: string
          created_at: string
          error_message: string | null
          id: string
          model: string
          parent_id: string | null
          prompt: string
          prompt_tokens: number | null
          provider: string
          response: string
          status: string
          title: string | null
          user_id: string
        }
        Insert: {
          canvas_h?: number
          canvas_w?: number
          canvas_x?: number
          canvas_y?: number
          completion_tokens?: number | null
          conversation_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          model: string
          parent_id?: string | null
          prompt: string
          prompt_tokens?: number | null
          provider: string
          response?: string
          status?: string
          title?: string | null
          user_id?: string
        }
        Update: {
          canvas_h?: number
          canvas_w?: number
          canvas_x?: number
          canvas_y?: number
          completion_tokens?: number | null
          conversation_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          model?: string
          parent_id?: string | null
          prompt?: string
          prompt_tokens?: number | null
          provider?: string
          response?: string
          status?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nodes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      provider_creds: {
        Row: {
          created_at: string
          encrypted_key: string
          id: string
          key_last4: string
          label: string | null
          provider: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          key_last4: string
          label?: string | null
          provider: string
          user_id?: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          key_last4?: string
          label?: string | null
          provider?: string
          user_id?: string
        }
        Relationships: []
      }
      skills: {
        Row: {
          created_at: string
          id: string
          instructions: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instructions?: string
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          instructions?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suggestions: {
        Row: {
          id: string
          node_id: string
          position: number
          taken_at: string | null
          text: string
        }
        Insert: {
          id?: string
          node_id: string
          position: number
          taken_at?: string | null
          text: string
        }
        Update: {
          id?: string
          node_id?: string
          position?: number
          taken_at?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      node_ancestors: {
        Args: { p_conversation: string; p_node: string }
        Returns: string[]
      }
      shared_conversation: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

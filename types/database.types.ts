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
      appointment_services: {
        Row: {
          appointment_id: string
          created_at: string
          duration_at_booking: number
          id: string
          price_at_booking: number
          professional_id: string
          service_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          duration_at_booking: number
          id?: string
          price_at_booking: number
          professional_id: string
          service_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          duration_at_booking?: number
          id?: string
          price_at_booking?: number
          professional_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          notes: string | null
          professional_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          notes?: string | null
          professional_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          notes?: string | null
          professional_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_executions: {
        Row: {
          appointment_id: string | null
          client_id: string | null
          conversation_id: string | null
          created_at: string
          error: string | null
          executed_at: string | null
          flow_id: string
          id: string
          message_id: string | null
          scheduled_for: string
          status: string
        }
        Insert: {
          appointment_id?: string | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          flow_id: string
          id?: string
          message_id?: string | null
          scheduled_for: string
          status?: string
        }
        Update: {
          appointment_id?: string | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          flow_id?: string
          id?: string
          message_id?: string | null
          scheduled_for?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_flows: {
        Row: {
          active: boolean
          created_at: string
          id: string
          message_body: string
          name: string
          service_filter_ids: string[]
          trigger: Database["public"]["Enums"]["automation_trigger"]
          trigger_offset_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          message_body: string
          name: string
          service_filter_ids?: string[]
          trigger: Database["public"]["Enums"]["automation_trigger"]
          trigger_offset_minutes?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          message_body?: string
          name?: string
          service_filter_ids?: string[]
          trigger?: Database["public"]["Enums"]["automation_trigger"]
          trigger_offset_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      budget_items: {
        Row: {
          budget_id: string
          id: string
          price_max: number
          price_min: number
          service_id: string | null
          service_name_snapshot: string
          sort_order: number
        }
        Insert: {
          budget_id: string
          id?: string
          price_max: number
          price_min: number
          service_id?: string | null
          service_name_snapshot: string
          sort_order?: number
        }
        Update: {
          budget_id?: string
          id?: string
          price_max?: number
          price_min?: number
          service_id?: string | null
          service_name_snapshot?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_payment_options: {
        Row: {
          budget_id: string
          id: string
          installments: number | null
          label_snapshot: string
          payment_method_id: string | null
          sort_order: number
          surcharge_percent: number
          total_max: number
          total_min: number
        }
        Insert: {
          budget_id: string
          id?: string
          installments?: number | null
          label_snapshot: string
          payment_method_id?: string | null
          sort_order?: number
          surcharge_percent: number
          total_max: number
          total_min: number
        }
        Update: {
          budget_id?: string
          id?: string
          installments?: number | null
          label_snapshot?: string
          payment_method_id?: string | null
          sort_order?: number
          surcharge_percent?: number
          total_max?: number
          total_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_payment_options_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_payment_options_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          client_id: string | null
          client_name_snapshot: string
          client_phone_snapshot: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          total_max: number
          total_min: number
        }
        Insert: {
          client_id?: string | null
          client_name_snapshot: string
          client_phone_snapshot?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          total_max: number
          total_min: number
        }
        Update: {
          client_id?: string | null
          client_name_snapshot?: string
          client_phone_snapshot?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          total_max?: number
          total_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          birthday: string | null
          created_at: string
          email: string | null
          full_name: string
          hair_notes: string | null
          id: string
          instagram_handle: string | null
          last_visit_at: string | null
          notes: string | null
          phone: string | null
          tags: string[]
          total_spent: number
          total_visits: number
          updated_at: string
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          hair_notes?: string | null
          id?: string
          instagram_handle?: string | null
          last_visit_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[]
          total_spent?: number
          total_visits?: number
          updated_at?: string
        }
        Update: {
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          hair_notes?: string | null
          id?: string
          instagram_handle?: string | null
          last_visit_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[]
          total_spent?: number
          total_visits?: number
          updated_at?: string
        }
        Relationships: []
      }
      commissions: {
        Row: {
          amount: number
          appointment_id: string
          appointment_service_id: string
          base_amount: number
          created_at: string
          id: string
          paid_at: string | null
          professional_id: string
          rate_at_payment: number
          status: Database["public"]["Enums"]["commission_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          appointment_id: string
          appointment_service_id: string
          base_amount: number
          created_at?: string
          id?: string
          paid_at?: string | null
          professional_id: string
          rate_at_payment: number
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string
          appointment_service_id?: string
          base_amount?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          professional_id?: string
          rate_at_payment?: number
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_appointment_service_id_fkey"
            columns: ["appointment_service_id"]
            isOneToOne: true
            referencedRelation: "appointment_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived: boolean
          avatar_path: string | null
          awaiting_reply: boolean
          channel: string
          client_id: string | null
          created_at: string
          display_name: string | null
          external_id: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          unread_count: number
          updated_at: string
          wa_phone: string | null
        }
        Insert: {
          archived?: boolean
          avatar_path?: string | null
          awaiting_reply?: boolean
          channel?: string
          client_id?: string | null
          created_at?: string
          display_name?: string | null
          external_id: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          unread_count?: number
          updated_at?: string
          wa_phone?: string | null
        }
        Update: {
          archived?: boolean
          avatar_path?: string | null
          awaiting_reply?: boolean
          channel?: string
          client_id?: string | null
          created_at?: string
          display_name?: string | null
          external_id?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          unread_count?: number
          updated_at?: string
          wa_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_templates: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          default_amount: number | null
          default_payment_method:
            | Database["public"]["Enums"]["payment_method"]
            | null
          due_day: number
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          default_amount?: number | null
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          due_day?: number
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          default_amount?: number | null
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          due_day?: number
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          cash_source_date: string | null
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          id: string
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          period: string | null
          professional_id: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          cash_source_date?: string | null
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          period?: string | null
          professional_id?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          cash_source_date?: string | null
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          period?: string | null
          professional_id?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "expense_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          error: string | null
          external_id: string | null
          failed_at: string | null
          id: string
          media_filename: string | null
          media_mime: string | null
          media_url: string | null
          reaction_target_external_id: string | null
          read_at: string | null
          reply_to_external_id: string | null
          sent_at: string
          sent_by: string | null
          status: Database["public"]["Enums"]["message_status"]
          transcription: string | null
          transcription_status: string | null
          type: Database["public"]["Enums"]["message_type"]
          updated_at: string
          wa_content: Json | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          error?: string | null
          external_id?: string | null
          failed_at?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_url?: string | null
          reaction_target_external_id?: string | null
          read_at?: string | null
          reply_to_external_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          transcription?: string | null
          transcription_status?: string | null
          type?: Database["public"]["Enums"]["message_type"]
          updated_at?: string
          wa_content?: Json | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["message_direction"]
          error?: string | null
          external_id?: string | null
          failed_at?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_url?: string | null
          reaction_target_external_id?: string | null
          read_at?: string | null
          reply_to_external_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          transcription?: string | null
          transcription_status?: string | null
          type?: Database["public"]["Enums"]["message_type"]
          updated_at?: string
          wa_content?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          active: boolean
          created_at: string
          id: string
          installments: number | null
          label: string
          sort_order: number
          surcharge_percent: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          installments?: number | null
          label: string
          sort_order?: number
          surcharge_percent?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          installments?: number | null
          label?: string
          sort_order?: number
          surcharge_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          appointment_id: string
          created_at: string
          created_by: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string
          updated_at: string
        }
        Insert: {
          amount: number
          appointment_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_schedules: {
        Row: {
          created_at: string
          end_time: string
          id: string
          professional_id: string
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          professional_id: string
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          professional_id?: string
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "professional_schedules_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_time_off: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          professional_id: string
          reason: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          professional_id: string
          reason?: string | null
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string
          reason?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_time_off_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          active: boolean
          color: string
          commission_rate: number
          commission_rate_net: number
          created_at: string
          full_name: string
          id: string
          phone: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          commission_rate?: number
          commission_rate_net?: number
          created_at?: string
          full_name: string
          id?: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          commission_rate?: number
          commission_rate_net?: number
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professionals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          label: string
          shortcut: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          label: string
          shortcut?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          label?: string
          shortcut?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["service_category"]
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: Database["public"]["Enums"]["service_category"]
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          name: string
          price: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["service_category"]
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_sessions: {
        Row: {
          key: string
          session_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          session_id: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          session_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      whatsapp_status: {
        Row: {
          last_connected_at: string | null
          last_error: string | null
          phone_number: string | null
          qr: string | null
          session_id: string
          state: string
          updated_at: string
        }
        Insert: {
          last_connected_at?: string | null
          last_error?: string | null
          phone_number?: string | null
          qr?: string | null
          session_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          last_connected_at?: string | null
          last_error?: string | null
          phone_number?: string | null
          qr?: string | null
          session_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_appointment_payment: {
        Args: { p_appointment_id: string; p_lines: Json; p_notes?: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "owner" | "receptionist" | "professional"
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "no_show"
        | "cancelled"
      automation_trigger:
        | "before_appointment"
        | "after_appointment"
        | "on_inbound_after_inactivity"
      commission_status: "pending" | "paid"
      expense_category:
        | "insumos"
        | "tinturas"
        | "alquiler"
        | "servicios"
        | "sueldos"
        | "marketing"
        | "otro"
      message_direction: "inbound" | "outbound"
      message_status:
        | "queued"
        | "sending"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
      message_type:
        | "text"
        | "image"
        | "video"
        | "audio"
        | "document"
        | "sticker"
        | "location"
        | "contact"
        | "reaction"
        | "system"
      payment_method:
        | "cash"
        | "transfer"
        | "credit_card"
        | "debit_card"
        | "mp"
        | "other"
      service_category:
        | "corte"
        | "color"
        | "tratamiento"
        | "manos"
        | "depilacion"
        | "make_up"
        | "peinado"
        | "otro"
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
      app_role: ["owner", "receptionist", "professional"],
      appointment_status: [
        "scheduled",
        "confirmed",
        "in_progress",
        "completed",
        "no_show",
        "cancelled",
      ],
      automation_trigger: [
        "before_appointment",
        "after_appointment",
        "on_inbound_after_inactivity",
      ],
      commission_status: ["pending", "paid"],
      expense_category: [
        "insumos",
        "tinturas",
        "alquiler",
        "servicios",
        "sueldos",
        "marketing",
        "otro",
      ],
      message_direction: ["inbound", "outbound"],
      message_status: [
        "queued",
        "sending",
        "sent",
        "delivered",
        "read",
        "failed",
      ],
      message_type: [
        "text",
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contact",
        "reaction",
        "system",
      ],
      payment_method: [
        "cash",
        "transfer",
        "credit_card",
        "debit_card",
        "mp",
        "other",
      ],
      service_category: [
        "corte",
        "color",
        "tratamiento",
        "manos",
        "depilacion",
        "make_up",
        "peinado",
        "otro",
      ],
    },
  },
} as const

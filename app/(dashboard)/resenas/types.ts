export type ReviewRequestRow = {
  id: string;
  asked_at: string;
  score: number | null;
  answered_at: string | null;
  feedback: string | null;
  case_status: string;
  case_notes: string | null;
  resolved_at: string | null;
  conversation_id: string | null;
  clients: { id: string; full_name: string; phone: string | null } | null;
  appointments: {
    starts_at: string;
    professionals: { full_name: string } | null;
    appointment_services: { services: { name: string } | null }[];
  } | null;
  automation_flows: { name: string } | null;
};

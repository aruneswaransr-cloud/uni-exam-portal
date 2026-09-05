import { supabase } from '@/lib/supabase';

export interface QuizQuestion {
  id: string;
  text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  marks: number;
  position: number;
}

export interface StartAttemptResult {
  ok: boolean;
  error?: string;
  submitted?: boolean;
  attempt?: {
    id: string;
    current_index: number;
    answered_count: number;
    started_at: string;
    submitted_at: string | null;
  };
  quiz?: {
    id: string;
    title: string;
    duration_minutes: number;
    status: string;
    num_questions: number;
    device_mode: string;
  };
  questions?: QuizQuestion[];
  question_order?: string[];
}

export async function startAttempt(participantId: string): Promise<StartAttemptResult> {
  const { data, error } = await supabase.rpc('start_attempt', { p_participant_id: participantId });
  if (error) return { ok: false, error: error.message };
  return data as StartAttemptResult;
}

export async function saveResponse(
  attemptId: string,
  questionId: string,
  selectedOption: string,
  currentIndex: number
): Promise<{ ok: boolean; answered_count?: number; error?: string; submitted?: boolean }> {
  const { data, error } = await supabase.rpc('save_response', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_selected_option: selectedOption,
    p_current_index: currentIndex,
  });
  if (error) return { ok: false, error: error.message };
  return data;
}

export async function submitAttempt(
  attemptId: string,
  endReason: 'manual' | 'timeout' | 'tab_switch' | 'network_lost' | 'admin_stopped' | 'fullscreen_exit'
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('submit_attempt', {
    p_attempt_id: attemptId,
    p_end_reason: endReason,
  });
  if (error) return { ok: false, error: error.message };
  return data;
}

export async function heartbeat(attemptId: string): Promise<void> {
  await supabase.rpc('heartbeat', { p_attempt_id: attemptId });
}

export async function getParticipantStatus(participantId: string) {
  const { data } = await supabase.rpc('get_participant_status', { p_participant_id: participantId });
  return data;
}

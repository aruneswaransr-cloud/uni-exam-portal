import { supabase } from '@/lib/supabase';
import type { Quiz, Question } from '@/types';
import { generateQuizCode } from '@/lib/questionParser';

export type DeviceMode = 'laptop' | 'mobile' | 'both';

export interface ParticipantField {
  id: string;
  label: string;
  type: 'text' | 'select';
  required: boolean;
  choices: string[];
  isDefault?: boolean;
  defaultKey?: 'full_name' | 'email' | 'phone' | 'register_number' | 'department';
}

export interface QuizInput {
  title: string;
  description: string;
  quizDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  maxParticipants: number;
  numQuestions: number;
  participantFields: ParticipantField[];
}

export async function createQuiz(input: QuizInput): Promise<{ data: Quiz | null; error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { data: null, error: 'Not authenticated.' };

  const { data: codeData, error: codeError } = await supabase.rpc('generate_quiz_code');
  if (codeError) return { data: null, error: codeError.message };
  const code = codeData as string;

  const { data, error } = await supabase
    .from('quizzes')
    .insert({
      title: input.title,
      description: input.description,
      quiz_date: input.quizDate,
      start_time: input.startTime,
      end_time: input.endTime,
      duration_minutes: input.durationMinutes,
      max_participants: input.maxParticipants,
      num_questions: input.numQuestions,
      status: 'DRAFT',
      code,
      created_by: userData.user.id,
      participant_fields: input.participantFields || [],
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as unknown as Quiz, error: null };
}

export async function fetchQuizzes(): Promise<{ data: Quiz[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('quizzes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: (data || []).map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    date: row.quiz_date,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes: row.duration_minutes,
    maxParticipants: row.max_participants,
    numQuestions: row.num_questions,
    status: row.status,
    evaluationMode: row.evaluation_mode as 'manual' | 'auto',
    deviceMode: (row.device_mode as DeviceMode) || 'both',
    participantFields: (row.participant_fields as ParticipantField[]) || [],
    createdAt: row.created_at,
  })) as unknown as Quiz[], error: null };
}

export async function updateQuizCode(quizId: string): Promise<{ code: string | null; error: string | null }> {
  const code = generateQuizCode();
  const { error } = await supabase.from('quizzes').update({ code }).eq('id', quizId);
  if (error) return { code: null, error: error.message };
  return { code, error: null };
}

export async function setQuizStatus(quizId: string, status: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('quizzes').update({ status }).eq('id', quizId);
  return { error: error?.message ?? null };
}

export async function startQuiz(quizId: string, deviceMode: DeviceMode = 'both'): Promise<{ code: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('start_quiz', { p_quiz_id: quizId, p_device_mode: deviceMode });
  if (error) return { code: null, error: error.message };
  if (data && !data.ok) return { code: null, error: data.error };
  return { code: data.code, error: null };
}

export async function updateQuizDuration(quizId: string, durationMinutes: number): Promise<{ error: string | null }> {
  const { data, error } = await supabase.rpc('update_quiz_duration', { p_quiz_id: quizId, p_duration_minutes: durationMinutes });
  if (error) return { error: error.message };
  if (data && !data.ok) return { error: data.error };
  return { error: null };
}

export async function setEvaluationMode(quizId: string, mode: 'manual' | 'auto'): Promise<{ error: string | null }> {
  const { error } = await supabase.from('quizzes').update({ evaluation_mode: mode }).eq('id', quizId);
  return { error: error?.message ?? null };
}

export async function updateParticipantInfo(
  participantId: string,
  data: { fullName?: string; email?: string; phone?: string; registerNumber?: string; department?: string; customFields?: Record<string, string> }
): Promise<{ error: string | null }> {
  const { data: rpcData, error } = await supabase.rpc('update_participant_info', {
    p_participant_id: participantId,
    p_full_name: data.fullName ?? null,
    p_email: data.email ?? null,
    p_phone: data.phone ?? null,
    p_register_number: data.registerNumber ?? null,
    p_department: data.department ?? null,
    p_custom_fields: data.customFields ?? null,
  });
  if (error) return { error: error.message };
  if (rpcData && !rpcData.ok) return { error: rpcData.error };
  return { error: null };
}

export async function allowRejoin(participantId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.rpc('allow_rejoin', { p_participant_id: participantId });
  if (error) return { error: error.message };
  if (data && !data.ok) return { error: data.error };
  return { error: null };
}

export async function removeParticipant(participantId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.rpc('remove_participant', { p_participant_id: participantId });
  if (error) return { error: error.message };
  if (data && !data.ok) return { error: data.error };
  return { error: null };
}

export async function autoEvaluateQuiz(quizId: string): Promise<{ data: { evaluated_responses: number; total_participants: number } | null; error: string | null }> {
  const { data, error } = await supabase.rpc('auto_evaluate_quiz', { p_quiz_id: quizId });
  if (error) return { data: null, error: error.message };
  if (data && !data.ok) return { data: null, error: data.error };
  return { data: { evaluated_responses: data.evaluated_responses, total_participants: data.total_participants }, error: null };
}

export async function updateQuizFields(quizId: string, fields: ParticipantField[]): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('quizzes')
    .update({ participant_fields: fields })
    .eq('id', quizId);
  return { error: error?.message ?? null };
}

export async function deleteQuiz(quizId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  return { error: error?.message ?? null };
}

export async function fetchQuestions(quizId: string): Promise<{ data: Question[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('quiz_id', quizId)
    .order('position', { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: (data || []).map((row) => ({
    id: row.id,
    quizId: row.quiz_id,
    order: row.position,
    text: row.text,
    optionA: row.option_a,
    optionB: row.option_b,
    optionC: row.option_c,
    optionD: row.option_d,
    marks: row.marks,
    correctOption: row.correct_option as 'A' | 'B' | 'C' | 'D' | null,
  })) as unknown as Question[], error: null };
}

export async function addQuestion(
  quizId: string,
  q: { text: string; optionA: string; optionB: string; optionC: string; optionD: string; marks: number; correctOption?: 'A' | 'B' | 'C' | 'D' | null },
): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from('questions')
    .select('position')
    .eq('quiz_id', quizId)
    .order('position', { ascending: false })
    .limit(1);

  const nextPos = (existing && existing.length > 0 ? (existing[0] as { position: number }).position : 0) + 1;

  const { error } = await supabase.from('questions').insert({
    quiz_id: quizId,
    text: q.text,
    option_a: q.optionA,
    option_b: q.optionB,
    option_c: q.optionC,
    option_d: q.optionD,
    marks: q.marks,
    correct_option: q.correctOption ?? null,
    position: nextPos,
  });
  return { error: error?.message ?? null };
}

export async function bulkAddQuestions(
  quizId: string,
  questions: { text: string; optionA: string; optionB: string; optionC: string; optionD: string; marks: number; correctOption?: 'A' | 'B' | 'C' | 'D' | null }[],
): Promise<{ imported: number; error: string | null }> {
  if (questions.length === 0) return { imported: 0, error: null };

  const { data: existing } = await supabase
    .from('questions')
    .select('position')
    .eq('quiz_id', quizId)
    .order('position', { ascending: false })
    .limit(1);

  let nextPos = (existing && existing.length > 0 ? (existing[0] as { position: number }).position : 0) + 1;

  const rows = questions.map((q) => ({
    quiz_id: quizId,
    text: q.text,
    option_a: q.optionA,
    option_b: q.optionB,
    option_c: q.optionC,
    option_d: q.optionD,
    marks: q.marks,
    correct_option: q.correctOption ?? null,
    position: nextPos++,
  }));

  const { error } = await supabase.from('questions').insert(rows);
  if (error) return { imported: 0, error: error.message };
  return { imported: questions.length, error: null };
}

export async function updateQuestion(
  questionId: string,
  q: { text: string; optionA: string; optionB: string; optionC: string; optionD: string; marks: number; correctOption?: 'A' | 'B' | 'C' | 'D' | null },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('questions')
    .update({
      text: q.text,
      option_a: q.optionA,
      option_b: q.optionB,
      option_c: q.optionC,
      option_d: q.optionD,
      marks: q.marks,
      correct_option: q.correctOption ?? null,
    })
    .eq('id', questionId);
  return { error: error?.message ?? null };
}

export async function deleteQuestion(questionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('questions').delete().eq('id', questionId);
  return { error: error?.message ?? null };
}

export async function reorderQuestions(quizId: string, orderedIds: string[]): Promise<{ error: string | null }> {
  const updates = orderedIds.map((id, index) =>
    supabase.from('questions').update({ position: index + 1 }).eq('id', id),
  );
  const results = await Promise.all(updates);
  const firstError = results.find((r) => r.error);
  return { error: firstError?.error?.message ?? null };
}

export async function approveParticipant(participantId: string, approved: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('participants')
    .update({ approved, rejected: !approved })
    .eq('id', participantId);
  return { error: error?.message ?? null };
}

export async function rejectParticipant(participantId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('participants')
    .update({ rejected: true, approved: false })
    .eq('id', participantId);
  return { error: error?.message ?? null };
}

export async function getQuizMonitor(quizId: string) {
  const { data, error } = await supabase.rpc('get_quiz_monitor', { p_quiz_id: quizId });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, data };
}

export async function fetchParticipantDetails(participantId: string) {
  const { data, error } = await supabase
    .from('participants')
    .select('phone, joined_at')
    .eq('id', participantId)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}


export async function getResults(quizId: string) {
  const { data, error } = await supabase.rpc('get_results', { p_quiz_id: quizId });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, data };
}

export async function evaluateResponse(responseId: string, marks: number): Promise<{ error: string | null }> {
  const { data, error } = await supabase.rpc('evaluate_response', {
    p_response_id: responseId,
    p_marks: marks,
  });
  if (error) return { error: error.message };
  if (data && !data.ok) return { error: data.error };
  return { error: null };
}

export async function fetchResponsesForAttempt(attemptId: string) {
  const { data, error } = await supabase
    .from('responses')
    .select('id, question_id, selected_option, saved_at')
    .eq('attempt_id', attemptId);
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function fetchEvaluationsForQuiz(quizId: string) {
  // We need to get evaluations for all responses in this quiz's attempts
  const { data, error } = await supabase
    .rpc('get_quiz_monitor', { p_quiz_id: quizId });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function uploadAnswerKey(quizId: string, answers: { position?: number; question_id?: string; correct_option: string }[]) {
  const { data, error } = await supabase.rpc('update_answer_key', {
    p_quiz_id: quizId,
    p_answers: answers,
  });
  if (error) return { ok: false as const, error: error.message };
  if (data && !data.ok) return { ok: false as const, error: data.error };
  return { ok: true as const, data };
}

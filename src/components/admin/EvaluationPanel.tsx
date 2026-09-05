import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Award, FileText, ChevronRight, ArrowLeft, CheckCircle2, Zap, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchQuestions, fetchResponsesForAttempt, evaluateResponse, getQuizMonitor, autoEvaluateQuiz } from '@/services/adminApi';
import { useToast } from '@/components/Toast';
import type { Question } from '@/types';

interface EvalParticipant {
  participant_id: string;
  full_name: string;
  email: string;
  phone: string;
  register_number: string;
  attempt_id: string | null;
  submitted_at: string | null;
  end_reason: string | null;
}

interface EvaluationPanelProps {
  quizId: string;
  participants: EvalParticipant[];
  evaluationMode: 'manual' | 'auto';
}

interface ResponseRow {
  id: string;
  question_id: string;
  selected_option: string | null;
  saved_at: string;
}

export function EvaluationPanel({ quizId, participants, evaluationMode }: EvaluationPanelProps) {
  const [selected, setSelected] = useState<EvalParticipant | null>(null);
  const [availableParticipants, setAvailableParticipants] = useState<EvalParticipant[]>(participants);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [autoEvaluating, setAutoEvaluating] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (participants.length > 0) {
      setAvailableParticipants(participants);
      return;
    }
    getQuizMonitor(quizId).then((result) => {
      if (result.ok && result.data.participants) {
        setAvailableParticipants(result.data.participants as EvalParticipant[]);
      }
    });
  }, [participants, quizId]);

  const submitted = availableParticipants.filter((p) => p.submitted_at && p.attempt_id);

  const loadDetail = useCallback(async (participant: EvalParticipant) => {
    if (!participant.attempt_id) return;
    setLoading(true);
    setSelected(participant);
    setMarks({});
    const [qRes, rRes] = await Promise.all([
      fetchQuestions(quizId),
      fetchResponsesForAttempt(participant.attempt_id),
    ]);
    setLoading(false);
    if (qRes.data) setQuestions(qRes.data);
    if (rRes.data) {
      setResponses(rRes.data as ResponseRow[]);
      // Load existing evaluations
      const evals = await supabase
        .from('evaluations')
        .select('response_id, marks_awarded')
        .in('response_id', (rRes.data as ResponseRow[]).map((r) => r.id));
      if (evals.data) {
        const m: Record<string, string> = {};
        (evals.data as { response_id: string; marks_awarded: number }[]).forEach((e) => {
          m[e.response_id] = String(e.marks_awarded);
        });
        setMarks(m);
      }
    }
  }, [quizId]);

  async function handleSave(responseId: string) {
    const val = parseFloat(marks[responseId] || '0');
    if (isNaN(val)) { toast.show('Please enter a valid number.', 'error'); return; }
    setSaving(responseId);
    const { error } = await evaluateResponse(responseId, val);
    setSaving(null);
    if (error) { toast.show(error, 'error'); return; }
    toast.show('Marks saved.', 'success');
  }

  async function handleAutoEvaluate() {
    setAutoEvaluating(true);
    const result = await autoEvaluateQuiz(quizId);
    setAutoEvaluating(false);
    if (result.error) { toast.show(result.error, 'error'); return; }
    toast.show(`Auto-evaluated ${result.data?.evaluated_responses ?? 0} responses for ${result.data?.total_participants ?? 0} participants.`, 'success');
  }

  if (selected) {
    const totalMarks = questions.reduce((s, q) => s + q.marks, 0);
    const obtained = responses.reduce((s, r) => {
      const q = questions.find((x) => x.id === r.question_id);
      const maxMark = q?.marks || 0;
      const val = parseFloat(marks[r.id] || '0');
      return s + (isNaN(val) ? 0 : Math.min(val, maxMark));
    }, 0);
    const percentage = totalMarks > 0 ? ((obtained / totalMarks) * 100).toFixed(1) : '0';

    return (
      <div>
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-sm font-600 text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to list
        </button>

        {/* Participant details */}
        <div className="mt-4 rounded-2xl border border-ink-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
          <h3 className="font-display text-lg font-700 text-ink-900">{selected.full_name}</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><span className="text-ink-400">Email</span><p className="font-600 text-ink-900">{selected.email}</p></div>
            <div><span className="text-ink-400">Phone</span><p className="font-600 text-ink-900">{selected.phone}</p></div>
            <div><span className="text-ink-400">Reg. No.</span><p className="font-600 text-ink-900">{selected.register_number}</p></div>
            <div><span className="text-ink-400">Submitted</span><p className="font-600 text-ink-900">{selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : '—'}</p></div>
          </div>
        </div>

        {/* Score summary */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-ink-200 bg-white p-4 text-center">
            <p className="text-xs font-500 text-ink-500">Total Marks</p>
            <p className="mt-1 font-display text-2xl font-700 text-ink-900">{totalMarks}</p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-4 text-center">
            <p className="text-xs font-500 text-ink-500">Marks Obtained</p>
            <p className="mt-1 font-display text-2xl font-700 text-primary-600">{obtained.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-4 text-center">
            <p className="text-xs font-500 text-ink-500">Percentage</p>
            <p className="mt-1 font-display text-2xl font-700 text-accent-600">{percentage}%</p>
          </div>
        </div>

        {/* Questions + responses */}
        <div className="mt-5 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>
          ) : (
            questions.map((q, i) => {
              const resp = responses.find((r) => r.question_id === q.id);
              const selectedOpt = resp?.selected_option;
              const optionLabel = selectedOpt ? (selectedOpt === 'A' ? q.optionA : selectedOpt === 'B' ? q.optionB : selectedOpt === 'C' ? q.optionC : selectedOpt === 'D' ? q.optionD : '—') : null;
              return (
                <div key={q.id} className="rounded-xl border border-ink-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
                  <div className="flex items-start gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-700 text-primary-700">{i + 1}</span>
                    <div className="flex-1">
                      <p className="font-600 text-ink-900">{q.text}</p>
                      <p className="mt-1 text-sm text-ink-500">
                        Participant answer: <span className="font-600 text-ink-900">{selectedOpt ? `${selectedOpt}) ${optionLabel}` : 'Not answered'}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-400">Max marks: {q.marks}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Award className="h-4 w-4 text-ink-400" />
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      max={q.marks}
                      value={marks[resp?.id || ''] || ''}
                      onChange={(e) => resp && setMarks((m) => ({ ...m, [resp.id]: e.target.value }))}
                      placeholder="0"
                      className="w-24 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                    />
                    <button
                      onClick={() => resp && handleSave(resp.id)}
                      disabled={saving === resp?.id}
                      className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-600 text-white hover:bg-primary-700 disabled:opacity-60"
                    >
                      {saving === resp?.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save
                    </button>
                    {marks[resp?.id || ''] !== undefined && marks[resp?.id || ''] !== '' && (
                      <CheckCircle2 className="h-4 w-4 text-success-500" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-700 text-ink-900">Evaluate Responses</h3>
          <p className="text-sm text-ink-500">Click a participant to review and award marks.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 ${evaluationMode === 'auto' ? 'bg-primary-50 text-primary-700' : 'bg-ink-100 text-ink-600'}`}>
            {evaluationMode === 'auto' ? <Zap className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
            {evaluationMode === 'auto' ? 'AI Auto-Evaluate' : 'Manual'}
          </span>
          <button
            onClick={handleAutoEvaluate}
            disabled={autoEvaluating || submitted.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-600 text-white transition hover:bg-primary-700 disabled:opacity-60"
          >
            {autoEvaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {autoEvaluating ? 'Evaluating…' : 'Auto-Evaluate All'}
          </button>
        </div>
      </div>

      {evaluationMode === 'auto' && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          <Zap className="mt-0.5 h-4 w-4 shrink-0" />
          <span>AI auto-evaluation is enabled. Click "Auto-Evaluate All" to automatically grade all submitted responses against the correct answers and calculate ranks and grades. You can still review and adjust individual marks below.</span>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {submitted.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-white py-10 text-center">
            <FileText className="h-8 w-8 text-ink-300" />
            <p className="mt-2 text-sm font-500 text-ink-500">No submitted responses to evaluate yet</p>
          </div>
        ) : (
          submitted.map((p) => (
            <button
              key={p.participant_id}
              onClick={() => loadDetail(p)}
              className="flex w-full items-center gap-3 rounded-xl border border-ink-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,20,28,0.04)] transition hover:border-primary-300 hover:shadow-[0_4px_12px_rgba(37,70,235,0.08)]"
            >
              <div className="flex-1">
                <p className="font-600 text-ink-900">{p.full_name}</p>
                <p className="text-xs text-ink-500">{p.register_number} · {p.email}</p>
              </div>
              <span className="text-xs text-ink-400">{p.submitted_at ? new Date(p.submitted_at).toLocaleString() : ''}</span>
              <ChevronRight className="h-5 w-5 text-ink-400" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

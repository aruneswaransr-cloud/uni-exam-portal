import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Users, Loader2, AlertCircle, CheckCircle2, Clock,
  XCircle, ArrowRight, KeyRound, UserCircle, RotateCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { ParticipantQuizRunner } from '@/components/ParticipantQuizRunner';
import type { ParticipantField } from '@/services/adminApi';

type Step = 'code' | 'register' | 'waiting' | 'rejoin_waiting' | 'rejected' | 'live';

interface QuizInfo {
  id: string;
  title: string;
  description: string | null;
  status: string;
  max_participants: number;
  participant_count: number;
  participant_fields?: ParticipantField[];
}

interface ParticipantInfo {
  id: string;
  full_name: string;
  approved: boolean;
  rejected: boolean;
  rejoin_requested?: boolean;
  rejoin_approved?: boolean;
}

const FALLBACK_FIELDS: ParticipantField[] = [
  { id: 'full_name', label: 'Full Name', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'full_name' },
  { id: 'email', label: 'Email', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'email' },
  { id: 'phone', label: 'Phone Number', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'phone' },
  { id: 'register_number', label: 'College Register Number', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'register_number' },
  { id: 'department', label: 'Department', type: 'select', required: true, choices: ['Computer Science', 'Information Technology', 'Electronics & Communication', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering', 'Chemical Engineering', 'Biotechnology', 'Aerospace Engineering', 'Other'], isDefault: true, defaultKey: 'department' },
];

export function ParticipantPage() {
  const toast = useToast();
  const [step, setStep] = useState<Step>('code');

  const [code, setCode] = useState('');
  const [quiz, setQuiz] = useState<QuizInfo | null>(null);
  const [participant, setParticipant] = useState<ParticipantInfo | null>(null);
  const [liveKey, setLiveKey] = useState(0);

  const [defaultValues, setDefaultValues] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields: ParticipantField[] = quiz?.participant_fields?.length ? quiz.participant_fields : FALLBACK_FIELDS;
  const defaultFields = fields.filter((f) => f.isDefault);
  const customFields = fields.filter((f) => !f.isDefault);

  // ---- Step 1: validate quiz code ----
  async function handleValidateCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError('Please enter a quiz code.');
      return;
    }
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('lookup_quiz_by_code', { p_code: code.trim() });
    setLoading(false);

    if (rpcError) {
      setError('Could not validate quiz code. Please check your connection and try again.');
      return;
    }

    if (!data || data.ok !== true) {
      setError(data?.error || 'Invalid quiz code.');
      return;
    }
    const q = data.quiz as QuizInfo;
    setQuiz(q);
    if (q.status !== 'DRAFT' && q.status !== 'WAITING' && q.status !== 'LIVE') {
      setError(
        q.status === 'STOPPED' ? 'This quiz is no longer accepting participants.' :
        q.status === 'COMPLETED' ? 'This quiz has been completed.' :
        'This quiz is not open for registration.'
      );
      return;
    }
    if (q.status === 'LIVE') {
      setError('This quiz has already started. If you were disconnected, you can re-register with the same details to request a rejoin.');
    }
    setStep('register');
  }

  // ---- Step 2: register participant ----
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    for (const f of fields) {
      if (f.required) {
        const val = f.isDefault ? (defaultValues[f.defaultKey!] || '') : (customValues[f.id] || '');
        if (!val.trim()) {
          setError(`${f.label} is required.`);
          return;
        }
      }
    }

    setLoading(true);

    const { data, error: rpcError } = await supabase.rpc('register_participant', {
      p_quiz_code: code.trim(),
      p_full_name: (defaultValues.full_name || '').trim(),
      p_email: (defaultValues.email || '').trim(),
      p_phone: (defaultValues.phone || '').trim(),
      p_register_number: (defaultValues.register_number || '').trim(),
      p_department: (defaultValues.department || '').trim(),
      p_custom_fields: customValues,
    });
    setLoading(false);

    if (rpcError) {
      setError('Registration failed. Please try again.');
      return;
    }

    if (!data || data.ok !== true) {
      setError(data?.error || 'Registration failed.');
      return;
    }

    setParticipant(data.participant as ParticipantInfo);

    if (data.rejoin) {
      setStep('rejoin_waiting');
      toast.show('Rejoin requested! Waiting for admin approval.', 'success');
    } else {
      setStep('waiting');
      toast.show('Registration successful! Waiting for admin approval.', 'success');
    }
  }

  // ---- Step 3: waiting room / rejoin polling ----
  useWaitingRoomPoll(participant?.id, (p, q) => {
    setParticipant(p);
    if (p.rejected) {
      setStep('rejected');
    } else if (p.rejoin_approved && q.status === 'LIVE') {
      setLiveKey((k) => k + 1);
      setStep('live');
    } else if (p.approved && q.status === 'LIVE' && !p.rejoin_requested) {
      setStep('live');
    }
  });

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 text-sm font-500 text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <Logo className="h-7" />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          {step === 'code' && (
            <CodeStep
              code={code} setCode={setCode}
              loading={loading} error={error}
              onSubmit={handleValidateCode}
            />
          )}

          {step === 'register' && quiz && (
            <RegisterStep
              quiz={quiz}
              fields={fields}
              defaultFields={defaultFields}
              customFields={customFields}
              defaultValues={defaultValues}
              setDefaultValues={setDefaultValues}
              customValues={customValues}
              setCustomValues={setCustomValues}
              loading={loading} error={error}
              onSubmit={handleRegister}
              onBack={() => { setStep('code'); setError(null); }}
            />
          )}

          {step === 'waiting' && quiz && participant && (
            <WaitingStep quiz={quiz} participant={participant} />
          )}

          {step === 'rejoin_waiting' && quiz && participant && (
            <RejoinWaitingStep quiz={quiz} participant={participant} />
          )}

          {step === 'rejected' && (
            <RejectedStep onBack={() => {
              setStep('code');
              setQuiz(null);
              setParticipant(null);
              setCode('');
              setError(null);
            }} />
          )}

          {step === 'live' && quiz && participant && (
            <LiveStep key={liveKey} quiz={quiz} participant={participant} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Step components ============

function CodeStep({ code, setCode, loading, error, onSubmit }: {
  code: string; setCode: (v: string) => void;
  loading: boolean; error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-500 text-white shadow-sm">
          <KeyRound className="h-6 w-6" strokeWidth={2.2} />
        </div>
        <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">Enter Quiz Code</h1>
        <p className="mt-1 text-sm text-ink-500">Enter the code shared by your quiz admin to join.</p>
      </div>

      <form onSubmit={onSubmit} className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
        {error && <ErrorBanner message={error} />}
        <label className="block text-sm font-500 text-ink-700">Quiz Code</label>
        <input
          type="text"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-center font-display text-lg font-600 tracking-widest text-ink-900 outline-none transition focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
          placeholder="QUIZ-XXXXX"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-600 text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {loading ? 'Validating…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

function RegisterStep({ quiz, fields, defaultFields, customFields, defaultValues, setDefaultValues, customValues, setCustomValues, loading, error, onSubmit, onBack }: {
  quiz: QuizInfo;
  fields: ParticipantField[];
  defaultFields: ParticipantField[];
  customFields: ParticipantField[];
  defaultValues: Record<string, string>;
  setDefaultValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  customValues: Record<string, string>;
  setCustomValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  loading: boolean; error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  function setDefault(key: string, val: string) {
    setDefaultValues((prev) => ({ ...prev, [key]: val }));
  }
  function setCustom(id: string, val: string) {
    setCustomValues((prev) => ({ ...prev, [id]: val }));
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-500 text-white shadow-sm">
          <UserCircle className="h-6 w-6" strokeWidth={2.2} />
        </div>
        <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">Participant Registration</h1>
        <p className="mt-1 text-sm text-ink-500">
          Quiz: <span className="font-600 text-ink-700">{quiz.title}</span>
        </p>
      </div>

      <form onSubmit={onSubmit} className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
        {error && <ErrorBanner message={error} />}

        {defaultFields.map((f) => {
          if (f.defaultKey === 'department' && f.type === 'select') {
            return (
              <div key={f.id} className="mt-4 first:mt-0">
                <label className="block text-sm font-500 text-ink-700">{f.label}</label>
                <select
                  required={f.required}
                  value={defaultValues.department || ''}
                  onChange={(e) => setDefault('department', e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
                >
                  <option value="">Select your department</option>
                  {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            );
          }
          const inputType = f.defaultKey === 'email' ? 'email' : f.defaultKey === 'phone' ? 'tel' : 'text';
          const placeholder = f.defaultKey === 'full_name' ? 'Jane Doe' : f.defaultKey === 'email' ? 'jane@college.edu' : f.defaultKey === 'phone' ? '+1 555 010 0000' : f.defaultKey === 'register_number' ? 'e.g. 21CS001' : '';
          return (
            <Field
              key={f.id}
              label={f.label}
              type={inputType}
              value={defaultValues[f.defaultKey!] || ''}
              onChange={(v) => setDefault(f.defaultKey!, v)}
              placeholder={placeholder}
              required={f.required}
            />
          );
        })}

        {customFields.map((f) => {
          if (f.type === 'select') {
            return (
              <div key={f.id} className="mt-4">
                <label className="block text-sm font-500 text-ink-700">{f.label}{f.required && <span className="text-danger-500"> *</span>}</label>
                <select
                  required={f.required}
                  value={customValues[f.id] || ''}
                  onChange={(e) => setCustom(f.id, e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
                >
                  <option value="">Select…</option>
                  {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            );
          }
          return (
            <Field
              key={f.id}
              label={f.label}
              value={customValues[f.id] || ''}
              onChange={(v) => setCustom(f.id, v)}
              placeholder={f.label}
              required={f.required}
            />
          );
        })}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-600 text-ink-700 transition hover:bg-ink-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-600 text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            {loading ? 'Registering…' : 'Register & Join'}
          </button>
        </div>
      </form>
    </div>
  );
}

function WaitingStep({ quiz, participant }: { quiz: QuizInfo; participant: ParticipantInfo }) {
  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary-50 text-primary-600 shadow-sm">
          <Clock className="h-6 w-6 animate-pulse" strokeWidth={2.2} />
        </div>
        <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">Waiting Room</h1>
        <p className="mt-1 text-sm text-ink-500">You're in the queue. The admin will approve you shortly.</p>
      </div>

      <div className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
        <InfoRow label="Your Name" value={participant.full_name} />
        <InfoRow label="Quiz" value={quiz.title} />
        <InfoRow
          label="Quiz Status"
          value={quiz.status}
          badge={<StatusBadge status={quiz.status} />}
        />
        <InfoRow
          label="Approval"
          value={participant.approved ? 'Approved' : 'Pending'}
          badge={
            participant.approved
              ? <span className="inline-flex items-center gap-1 rounded-full bg-success-500/10 px-2.5 py-0.5 text-xs font-600 text-success-500"><CheckCircle2 className="h-3.5 w-3.5" /> Approved</span>
              : <span className="inline-flex items-center gap-1 rounded-full bg-warning-500/10 px-2.5 py-0.5 text-xs font-600 text-warning-500"><Clock className="h-3.5 w-3.5" /> Pending</span>
          }
        />

        <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-primary-50 px-4 py-3 text-sm font-500 text-primary-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for admin approval…
        </div>
        <p className="mt-3 text-center text-xs text-ink-400">
          This page updates automatically. You'll be moved to the quiz when it starts.
        </p>
      </div>
    </div>
  );
}

function RejoinWaitingStep({ quiz, participant }: { quiz: QuizInfo; participant: ParticipantInfo }) {
  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-warning-500/10 text-warning-500 shadow-sm">
          <RotateCw className="h-6 w-6 animate-spin" strokeWidth={2.2} />
        </div>
        <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">Rejoin Requested</h1>
        <p className="mt-1 text-sm text-ink-500">Your previous attempt was submitted. Waiting for the admin to allow you back in.</p>
      </div>

      <div className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
        <InfoRow label="Your Name" value={participant.full_name} />
        <InfoRow label="Quiz" value={quiz.title} />
        <InfoRow
          label="Quiz Status"
          value={quiz.status}
          badge={<StatusBadge status={quiz.status} />}
        />
        <InfoRow
          label="Rejoin Status"
          value="Pending"
          badge={<span className="inline-flex items-center gap-1 rounded-full bg-warning-500/10 px-2.5 py-0.5 text-xs font-600 text-warning-500"><Clock className="h-3.5 w-3.5" /> Awaiting admin</span>}
        />

        <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-warning-500/10 px-4 py-3 text-sm font-500 text-warning-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for admin to allow your rejoin…
        </div>
        <p className="mt-3 text-center text-xs text-ink-400">
          Once the admin approves your rejoin, you'll be taken back into the quiz automatically.
        </p>
      </div>
    </div>
  );
}

function RejectedStep({ onBack }: { onBack: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger-500/10 text-danger-500 shadow-sm">
        <XCircle className="h-6 w-6" strokeWidth={2.2} />
      </div>
      <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">Registration Rejected</h1>
      <p className="mt-2 text-sm text-ink-500">
        The quiz admin did not approve your registration. Please contact the organizer if you believe this is an error.
      </p>
      <button
        onClick={onBack}
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-600 text-ink-700 transition hover:bg-ink-50"
      >
        <ArrowLeft className="h-4 w-4" /> Try another quiz
      </button>
    </div>
  );
}

function LiveStep({ quiz, participant }: { quiz: QuizInfo; participant: ParticipantInfo }) {
  return <ParticipantQuizRunner participantId={participant.id} onSubmitted={() => undefined} />;
}

// ============ Helpers ============

function Field({ label, value, onChange, type = 'text', placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <label className="block text-sm font-500 text-ink-700">{label}{required && <span className="text-danger-500"> *</span>}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
        placeholder={placeholder}
      />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-sm text-danger-500">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function InfoRow({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-100 py-2.5 last:border-0">
      <span className="text-sm font-500 text-ink-500">{label}</span>
      <span className="flex items-center gap-2 text-sm font-600 text-ink-900">{value}{badge}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-ink-100 text-ink-600',
    WAITING: 'bg-warning-500/10 text-warning-500',
    LIVE: 'bg-success-500/10 text-success-500',
    STOPPED: 'bg-danger-500/10 text-danger-500',
    COMPLETED: 'bg-primary-50 text-primary-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-600 ${map[status] || 'bg-ink-100 text-ink-600'}`}>
      {status}
    </span>
  );
}

// ============ Waiting room polling hook ============

function useWaitingRoomPoll(
  participantId: string | undefined,
  onUpdate: (p: ParticipantInfo, q: QuizInfo) => void
) {
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  useEffect(() => {
    if (!participantId) return;
    let active = true;

    async function poll() {
      while (active) {
        try {
          const { data } = await supabase.rpc('get_participant_status', { p_participant_id: participantId });
          if (active && data && data.ok) {
            cbRef.current(data.participant as ParticipantInfo, data.quiz as QuizInfo);
          }
        } catch {
          // Network hiccup — keep polling
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    poll();
    return () => { active = false; };
  }, [participantId]);
}

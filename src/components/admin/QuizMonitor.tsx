import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Check, X, Clock, Users, CheckCircle2, AlertCircle,
  WifiOff, MonitorPlay, LogOut, Eye, UserRound, RotateCw, Edit3,
} from 'lucide-react';
import { getQuizMonitor, approveParticipant, rejectParticipant, fetchParticipantDetails, removeParticipant, allowRejoin, updateParticipantInfo, type ParticipantField } from '@/services/adminApi';
import { useToast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Trash2 } from 'lucide-react';

interface MonitorParticipant {
  participant_id: string;
  full_name: string;
  email: string;
  register_number: string;
  approved: boolean;
  rejected: boolean;
  attempt_id: string | null;
  answered_count: number;
  current_index: number;
  started_at: string | null;
  submitted_at: string | null;
  end_reason: string | null;
  last_seen_at: string | null;
  rejoin_requested: boolean;
  rejoin_approved: boolean;
  rejoin_requested_at: string | null;
  department: string | null;
  phone: string;
  joined_at: string | null;
  custom_fields: Record<string, string> | null;
}

interface MonitorStats {
  total_participants: number;
  approved: number;
  waiting: number;
  rejected: number;
  submitted: number;
  in_progress: number;
  rejoin_pending: number;
}

interface QuizMonitorProps {
  quizId: string;
  quizStatus: string;
  numQuestions: number;
}

export function QuizMonitor({ quizId, quizStatus, numQuestions }: QuizMonitorProps) {
  const toast = useToast();
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [participants, setParticipants] = useState<MonitorParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'waiting' | 'approved' | 'live' | 'submitted' | 'rejoin'>('waiting');
  const [details, setDetails] = useState<MonitorParticipant | null>(null);
  const [editTarget, setEditTarget] = useState<MonitorParticipant | null>(null);
  const [participantFields, setParticipantFields] = useState<ParticipantField[]>([]);
  const active = useRef(true);

  const load = useCallback(async () => {
    const result = await getQuizMonitor(quizId);
    if (!result.ok) {
      setLoading(false);
      return;
    }
    setStats(result.data.stats as MonitorStats);
    setParticipants(result.data.participants as MonitorParticipant[]);
    setParticipantFields((result.data.quiz?.participant_fields as ParticipantField[]) || []);
    setLoading(false);
  }, [quizId]);

  useEffect(() => {
    active.current = true;
    load();
    const interval = setInterval(() => {
      if (active.current) load();
    }, 4000);
    return () => {
      active.current = false;
      clearInterval(interval);
    };
  }, [load]);

  async function handleApprove(id: string) {
    const { error } = await approveParticipant(id, true);
    if (error) { toast.show(error, 'error'); return; }
    toast.show('Participant approved.', 'success');
    load();
  }

  async function handleReject(id: string) {
    const { error } = await rejectParticipant(id);
    if (error) { toast.show(error, 'error'); return; }
    toast.show('Participant rejected.', 'success');
    load();
  }

  async function handleAllowRejoin(id: string) {
    const { error } = await allowRejoin(id);
    if (error) { toast.show(error, 'error'); return; }
    toast.show('Rejoin approved. The participant can now re-enter the quiz.', 'success');
    load();
  }

  async function handleSaveEdit(data: { fullName: string; email: string; phone: string; registerNumber: string; department: string; customFields?: Record<string, string> }) {
    if (!editTarget) return;
    const { error } = await updateParticipantInfo(editTarget.participant_id, {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      registerNumber: data.registerNumber,
      department: data.department,
      customFields: data.customFields,
    });
    if (error) { toast.show(error, 'error'); return; }
    toast.show('Participant info updated.', 'success');
    setEditTarget(null);
    load();
  }

  const [removeTarget, setRemoveTarget] = useState<MonitorParticipant | null>(null);

  async function handleRemove() {
    if (!removeTarget) return;
    const { error } = await removeParticipant(removeTarget.participant_id);
    if (error) { toast.show(error, 'error'); setRemoveTarget(null); return; }
    toast.show('Participant removed.', 'success');
    setRemoveTarget(null);
    load();
  }

  async function handleDetails(participant: MonitorParticipant) {
    const result = await fetchParticipantDetails(participant.participant_id);
    if (result.error || !result.data) { toast.show(result.error || 'Could not load participant details.', 'error'); return; }
    setDetails({ ...participant, ...result.data });
  }

  const waiting = participants.filter((p) => !p.approved && !p.rejected && !p.rejoin_requested);
  const approved = participants.filter((p) => p.approved && !p.rejected && !p.submitted_at && !p.rejoin_requested);
  const inProgress = approved.filter((p) => p.attempt_id);
  const submitted = participants.filter((p) => p.submitted_at && !p.rejoin_requested);
  const rejoinPending = participants.filter((p) => p.rejoin_requested && !p.rejoin_approved);

  const tabs = [
    { key: 'waiting' as const, label: 'Waiting', count: stats?.waiting ?? 0, icon: Clock },
    { key: 'rejoin' as const, label: 'Rejoin', count: stats?.rejoin_pending ?? 0, icon: RotateCw },
    { key: 'approved' as const, label: 'Approved', count: stats?.approved ?? 0, icon: CheckCircle2 },
    { key: 'live' as const, label: 'In Progress', count: stats?.in_progress ?? 0, icon: MonitorPlay },
    { key: 'submitted' as const, label: 'Submitted', count: stats?.submitted ?? 0, icon: Users },
  ];

  const visible = tab === 'waiting' ? waiting : tab === 'rejoin' ? rejoinPending : tab === 'approved' ? approved : tab === 'live' ? inProgress : submitted;

  return (
    <>
    <div>
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total" value={stats?.total_participants ?? 0} icon={Users} color="text-ink-700 bg-ink-100" />
        <StatCard label="Waiting" value={stats?.waiting ?? 0} icon={Clock} color="text-warning-500 bg-warning-500/10" />
        <StatCard label="Approved" value={stats?.approved ?? 0} icon={CheckCircle2} color="text-success-500 bg-success-500/10" />
        <StatCard label="In Progress" value={stats?.in_progress ?? 0} icon={MonitorPlay} color="text-primary-600 bg-primary-50" />
        <StatCard label="Submitted" value={stats?.submitted ?? 0} icon={Check} color="text-accent-600 bg-accent-50" />
        <StatCard label="Rejoin" value={stats?.rejoin_pending ?? 0} icon={RotateCw} color="text-primary-600 bg-primary-50" />
        <StatCard label="Rejected" value={stats?.rejected ?? 0} icon={X} color="text-danger-500 bg-danger-500/10" />
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-ink-200 bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-600 transition ${
              tab === t.key ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
            <span className={`rounded-full px-1.5 py-0.5 text-xs ${tab === t.key ? 'bg-white/20' : 'bg-ink-100'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-white py-10 text-center">
            <AlertCircle className="h-8 w-8 text-ink-300" />
            <p className="mt-2 text-sm font-500 text-ink-500">No participants in this category</p>
          </div>
        ) : (
          visible.map((p) => <ParticipantRow key={p.participant_id} p={p} tab={tab} numQuestions={numQuestions} onApprove={handleApprove} onReject={handleReject} onAllowRejoin={handleAllowRejoin} onDetails={() => void handleDetails(p)} onEdit={() => setEditTarget(p)} onRemove={() => setRemoveTarget(p)} />)
        )}
      </div>
    </div>
      {details && <ParticipantDetails participant={details} fields={participantFields} onClose={() => setDetails(null)} />}
      {editTarget && <EditParticipantModal participant={editTarget} fields={participantFields} onSave={handleSaveEdit} onCancel={() => setEditTarget(null)} />}
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove participant"
        message={<>This will permanently remove <strong>{removeTarget?.full_name}</strong> from the quiz, including any submitted responses. This cannot be undone.</>}
        confirmLabel="Remove"
        danger
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; color: string }) {
  return (
    <div className="rounded-xl border border-ink-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
      <div className={`grid h-8 w-8 place-items-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 font-display text-2xl font-700 text-ink-900">{value}</p>
      <p className="text-xs font-500 text-ink-500">{label}</p>
    </div>
  );
}

function ParticipantRow({
  p, tab, numQuestions, onApprove, onReject, onAllowRejoin, onDetails, onEdit, onRemove,
}: {
  p: MonitorParticipant;
  tab: string;
  numQuestions: number;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAllowRejoin: (id: string) => void;
  onDetails: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
      <div className="flex-1 min-w-[200px]">
        <p className="font-600 text-ink-900">{p.full_name}</p>
        <p className="text-xs text-ink-500">{p.email} · {p.register_number}</p>
      </div>

      {/* Live status indicators */}
      {tab === 'live' && (
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-600 text-ink-900">{p.answered_count} / {numQuestions} answered</p>
            <p className="text-xs text-ink-500">Q {p.current_index + 1} of {numQuestions}</p>
          </div>
          <div className="h-2 w-24 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${(p.answered_count / Math.max(1, numQuestions)) * 100}%` }} />
          </div>
        </div>
      )}

      {tab === 'submitted' && (
        <div className="flex items-center gap-2">
          <EndReasonBadge reason={p.end_reason} />
          <span className="text-xs text-ink-500">
            {p.submitted_at ? new Date(p.submitted_at).toLocaleTimeString() : ''}
          </span>
        </div>
      )}

      <button onClick={onDetails} className="flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-600 text-ink-700 transition hover:bg-ink-50"><UserRound className="h-4 w-4" /> Details</button>

      <button onClick={onEdit} title="Edit participant info" className="flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-600 text-ink-700 transition hover:bg-ink-50"><Edit3 className="h-4 w-4" /> Edit</button>

      <button onClick={onRemove} title="Remove participant" className="flex items-center gap-1 rounded-lg border border-danger-500/30 bg-white px-3 py-1.5 text-sm font-600 text-danger-500 transition hover:bg-danger-500/5"><Trash2 className="h-4 w-4" /> Remove</button>

      {tab === 'waiting' && (
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(p.participant_id)}
            className="flex items-center gap-1 rounded-lg bg-success-500 px-3 py-1.5 text-sm font-600 text-white transition hover:bg-success-500/90"
          >
            <Check className="h-4 w-4" /> Approve
          </button>
          <button
            onClick={() => onReject(p.participant_id)}
            className="flex items-center gap-1 rounded-lg border border-danger-500/30 bg-white px-3 py-1.5 text-sm font-600 text-danger-500 transition hover:bg-danger-500/5"
          >
            <X className="h-4 w-4" /> Reject
          </button>
        </div>
      )}

      {tab === 'rejoin' && (
        <div className="flex items-center gap-2">
          {p.end_reason && <EndReasonBadge reason={p.end_reason} />}
          <button
            onClick={() => onAllowRejoin(p.participant_id)}
            className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-600 text-white transition hover:bg-primary-700"
          >
            <RotateCw className="h-4 w-4" /> Allow Rejoin
          </button>
        </div>
      )}
    </div>
  );
}

function ParticipantDetails({ participant, fields, onClose }: { participant: MonitorParticipant; fields: ParticipantField[]; onClose: () => void }) {
  const customFields = fields.filter((f) => !f.isDefault);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/40 p-5" onClick={onClose}><div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-ink-200 bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-xs font-700 uppercase tracking-wide text-primary-600">Participant details</p><h3 className="mt-1 font-display text-xl font-700 text-ink-900">{participant.full_name}</h3></div><button onClick={onClose} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Close details"><X className="h-5 w-5" /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Detail label="Email" value={participant.email} /><Detail label="Phone" value={participant.phone || 'Not provided'} /><Detail label="Register number" value={participant.register_number} /><Detail label="Department" value={participant.department || 'Not specified'} />{customFields.map((f) => <Detail key={f.id} label={f.label} value={participant.custom_fields?.[f.id] || 'Not provided'} />)}<Detail label="Joined" value={participant.joined_at ? new Date(participant.joined_at).toLocaleString() : '—'} /><Detail label="Approval" value={participant.rejected ? 'Rejected' : participant.approved ? 'Approved' : 'Waiting'} /><Detail label="Attempt status" value={participant.submitted_at ? 'Submitted' : participant.attempt_id ? 'In progress' : 'Not started'} /><Detail label="Last seen" value={participant.last_seen_at ? new Date(participant.last_seen_at).toLocaleString() : '—'} /><Detail label="End reason" value={participant.end_reason || '—'} /><Detail label="Rejoin requested" value={participant.rejoin_requested ? (participant.rejoin_requested_at ? new Date(participant.rejoin_requested_at).toLocaleString() : 'Yes') : 'No'} /><Detail label="Rejoin approved" value={participant.rejoin_approved ? 'Yes' : 'No'} /></div></div></div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-ink-50 px-3 py-2"><p className="text-xs text-ink-400">{label}</p><p className="mt-1 break-words text-sm font-600 text-ink-800">{value}</p></div>; }

function EditParticipantModal({ participant, fields, onSave, onCancel }: {
  participant: MonitorParticipant;
  fields: ParticipantField[];
  onSave: (data: { fullName: string; email: string; phone: string; registerNumber: string; department: string; customFields?: Record<string, string> }) => void;
  onCancel: () => void;
}) {
  const customFieldDefs = fields.filter((f) => !f.isDefault);
  const [fullName, setFullName] = useState(participant.full_name);
  const [email, setEmail] = useState(participant.email);
  const [phone, setPhone] = useState(participant.phone || '');
  const [regNumber, setRegNumber] = useState(participant.register_number);
  const [department, setDepartment] = useState(participant.department || '');
  const [customValues, setCustomValues] = useState<Record<string, string>>(participant.custom_fields || {});
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    onSave({ fullName, email, phone, registerNumber: regNumber, department, customFields: customValues });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/40 p-5" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-2xl border border-ink-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-700 uppercase tracking-wide text-primary-600">Edit participant</p>
            <h3 className="mt-1 font-display text-xl font-700 text-ink-900">{participant.full_name}</h3>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Close edit"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="mt-5 grid gap-3">
          <EditField label="Full Name" value={fullName} onChange={setFullName} />
          <EditField label="Email" value={email} onChange={setEmail} type="email" />
          <EditField label="Phone" value={phone} onChange={setPhone} type="tel" />
          <EditField label="Register Number" value={regNumber} onChange={setRegNumber} />
          <div>
            <label className="block text-sm font-500 text-ink-700">Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
              <option value="">Not specified</option>
              <option value="Computer Science">Computer Science</option>
              <option value="Information Technology">Information Technology</option>
              <option value="Electronics & Communication">Electronics &amp; Communication</option>
              <option value="Electrical Engineering">Electrical Engineering</option>
              <option value="Mechanical Engineering">Mechanical Engineering</option>
              <option value="Civil Engineering">Civil Engineering</option>
              <option value="Chemical Engineering">Chemical Engineering</option>
              <option value="Biotechnology">Biotechnology</option>
              <option value="Aerospace Engineering">Aerospace Engineering</option>
              <option value="Other">Other</option>
            </select>
          </div>
          {customFieldDefs.length > 0 && (
            <div className="mt-2 border-t border-ink-100 pt-3">
              <p className="mb-2 text-xs font-700 uppercase tracking-wide text-ink-400">Additional fields</p>
              {customFieldDefs.map((f) => {
                if (f.type === 'select') {
                  return (
                    <div key={f.id}>
                      <label className="block text-sm font-500 text-ink-700">{f.label}</label>
                      <select value={customValues[f.id] || ''} onChange={(e) => setCustomValues((prev) => ({ ...prev, [f.id]: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
                        <option value="">Not specified</option>
                        {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  );
                }
                return (
                  <EditField key={f.id} label={f.label} value={customValues[f.id] || ''} onChange={(v) => setCustomValues((prev) => ({ ...prev, [f.id]: v }))} />
                );
              })}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={onCancel} className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-600 text-ink-700 hover:bg-ink-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-600 text-white hover:bg-primary-700 disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />} Save changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-sm font-500 text-ink-700">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
    </div>
  );
}

function EndReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return null;
  const map: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
    manual: { label: 'Submitted', icon: Check, color: 'bg-success-500/10 text-success-500' },
    timeout: { label: 'Time Up', icon: Clock, color: 'bg-warning-500/10 text-warning-500' },
    tab_switch: { label: 'Tab Switch', icon: LogOut, color: 'bg-danger-500/10 text-danger-500' },
    network_lost: { label: 'Network Lost', icon: WifiOff, color: 'bg-danger-500/10 text-danger-500' },
    admin_stopped: { label: 'Admin Stopped', icon: Eye, color: 'bg-ink-100 text-ink-600' },
  };
  const info = map[reason] || { label: reason, icon: AlertCircle, color: 'bg-ink-100 text-ink-600' };
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-600 ${info.color}`}>
      <Icon className="h-3.5 w-3.5" /> {info.label}
    </span>
  );
}

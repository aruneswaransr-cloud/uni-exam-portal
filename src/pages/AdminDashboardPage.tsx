import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, FileText, LayoutDashboard, Loader2, LogOut, Monitor, Smartphone, Plus, Radio, RefreshCw, Settings2, ShieldCheck, Trash2, Trophy, Users, X, RotateCw, Clock, Save, MonitorSmartphone, ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/Toast';
import { CreateQuizModal } from '@/components/admin/CreateQuizModal';
import { QuestionManager } from '@/components/admin/QuestionManager';
import { QuizMonitor } from '@/components/admin/QuizMonitor';
import { EvaluationPanel } from '@/components/admin/EvaluationPanel';
import { ResultsPanel } from '@/components/admin/ResultsPanel';
import { EditFieldsModal } from '@/components/admin/EditFieldsModal';
import { fetchQuizzes, setQuizStatus, updateQuizCode, startQuiz, setEvaluationMode, deleteQuiz, updateQuizDuration, getQuizMonitor, type DeviceMode, type ParticipantField } from '@/services/adminApi';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type QuizRecord = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  maxParticipants: number;
  numQuestions: number;
  status: string;
  evaluationMode: 'manual' | 'auto';
  deviceMode: DeviceMode;
  participantFields: ParticipantField[];
  createdAt: string;
};
type Panel = 'questions' | 'monitor' | 'evaluation' | 'results';

export function AdminDashboardPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([]);
  const [selected, setSelected] = useState<QuizRecord | null>(null);
  const [panel, setPanel] = useState<Panel>('questions');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startModal, setStartModal] = useState<QuizRecord | null>(null);
  const [showEditFields, setShowEditFields] = useState(false);
  const [liveStats, setLiveStats] = useState<Record<string, { inProgress: number; rejoinPending: number }>>({});
  const prevWaitingRef = useRef<Record<string, number>>({});
  const prevRejoinRef = useRef<Record<string, number>>({});
  const [joinNotification, setJoinNotification] = useState<{ name: string; type: 'join' | 'rejoin'; quizTitle: string } | null>(null);
  const notifTimerRef = useRef<number | null>(null);

  const loadQuizzes = useCallback(async () => {
    setLoading(true);
    const result = await fetchQuizzes();
    setLoading(false);
    if (result.error) {
      toast.show(result.error, 'error');
      return;
    }
    const rows = (result.data || []) as unknown as QuizRecord[];
    setQuizzes(rows);
    setSelected((current) => current ? rows.find((q) => q.id === current.id) || null : current);
  }, [toast]);

  useEffect(() => { loadQuizzes(); }, [loadQuizzes]);

  // Poll live stats for all LIVE quizzes
  useEffect(() => {
    const liveIds = quizzes.filter((q) => q.status === 'LIVE').map((q) => q.id);
    if (liveIds.length === 0) { setLiveStats({}); return; }
    let active = true;
    async function fetchStats() {
      const updates: Record<string, { inProgress: number; rejoinPending: number }> = {};
      const newWaiting: Record<string, number> = {};
      const newRejoin: Record<string, number> = {};
      for (const id of liveIds) {
        try {
          const result = await getQuizMonitor(id);
          if (result.ok && result.data?.stats) {
            updates[id] = {
              inProgress: result.data.stats.in_progress ?? 0,
              rejoinPending: result.data.stats.rejoin_pending ?? 0,
            };
            newWaiting[id] = result.data.stats.waiting ?? 0;
            newRejoin[id] = result.data.stats.rejoin_pending ?? 0;
          }
        } catch {
          // Skip this quiz on network error — keep polling
        }
      }
      if (!active) return;
      setLiveStats(updates);

      // Check for new join/rejoin requests and show notification
      let notif: { name: string; type: 'join' | 'rejoin'; quizTitle: string } | null = null;
      for (const id of liveIds) {
        const prevW = prevWaitingRef.current[id] ?? 0;
        const prevR = prevRejoinRef.current[id] ?? 0;
        const currW = newWaiting[id] ?? 0;
        const currR = newRejoin[id] ?? 0;
        const quizTitle = quizzes.find((q) => q.id === id)?.title || 'a quiz';
        if (currW > prevW) {
          notif = { name: `${currW - prevW} new participant${currW - prevW > 1 ? 's' : ''}`, type: 'join', quizTitle };
        } else if (currR > prevR) {
          notif = { name: `${currR - prevR} rejoin request${currR - prevR > 1 ? 's' : ''}`, type: 'rejoin', quizTitle };
        }
      }
      prevWaitingRef.current = newWaiting;
      prevRejoinRef.current = newRejoin;
      if (notif) {
        setJoinNotification(notif);
        if (notifTimerRef.current) window.clearTimeout(notifTimerRef.current);
        notifTimerRef.current = window.setTimeout(() => setJoinNotification(null), 6000);
      }
    }
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => { active = false; clearInterval(interval); if (notifTimerRef.current) window.clearTimeout(notifTimerRef.current); };
  }, [quizzes]);

  async function handleSignOut() {
    await signOut();
    navigate('/admin');
  }

  async function changeStatus(status: string) {
    if (!selected) return;
    if (status === 'LIVE') {
      setStartModal(selected);
      return;
    }
    const result = await setQuizStatus(selected.id, status);
    if (result.error) { toast.show(result.error, 'error'); return; }
    toast.show(`Quiz moved to ${status.toLowerCase()}.`, 'success');
    await loadQuizzes();
  }

  async function handleStartWithDevice(deviceMode: DeviceMode) {
    if (!startModal) return;
    const result = await startQuiz(startModal.id, deviceMode);
    if (result.error) { toast.show(result.error || 'Could not start quiz.', 'error'); return; }
    toast.show('Quiz is now live! Participants taking the quiz can begin answering.', 'success');
    setStartModal(null);
    await loadQuizzes();
  }

  async function regenerateCode() {
    if (!selected) return;
    const result = await updateQuizCode(selected.id);
    if (result.error || !result.code) { toast.show(result.error || 'Could not generate a code.', 'error'); return; }
    toast.show(`New quiz code: ${result.code}`, 'success');
    await loadQuizzes();
  }

  async function changeEvaluationMode(mode: 'manual' | 'auto') {
    if (!selected) return;
    const result = await setEvaluationMode(selected.id, mode);
    if (result.error) { toast.show(result.error, 'error'); return; }
    toast.show(`Evaluation mode set to ${mode === 'auto' ? 'AI auto-evaluate' : 'manual'}.`, 'success');
    await loadQuizzes();
  }

  const [deleteTarget, setDeleteTarget] = useState<QuizRecord | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteQuiz(deleteTarget.id);
    if (result.error) { toast.show(result.error, 'error'); setDeleteTarget(null); return; }
    toast.show(`Quiz "${deleteTarget.title}" deleted.`, 'success');
    setDeleteTarget(null);
    setSelected(null);
    await loadQuizzes();
  }

  function copyCode() {
    if (!selected || !selected.code) return;
    navigator.clipboard.writeText(selected.code).then(() => toast.show('Quiz code copied.', 'success'));
  }

  const activeCount = quizzes.filter((q) => q.status === 'LIVE').length;
  const waitingCount = quizzes.filter((q) => q.status === 'WAITING').length;
  const totalInProgress = Object.values(liveStats).reduce((sum, s) => sum + s.inProgress, 0);
  const totalRejoinPending = Object.values(liveStats).reduce((sum, s) => sum + s.rejoinPending, 0);

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Logo className="h-7" />
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-600 text-primary-700 sm:flex"><ShieldCheck className="h-3.5 w-3.5" /> Admin</span>
            <span className="hidden text-sm font-500 text-ink-700 md:block">{profile?.email}</span>
            <button onClick={handleSignOut} className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-500 text-ink-700 transition hover:bg-ink-50"><LogOut className="h-4 w-4" /> Logout</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-600 text-primary-600"><LayoutDashboard className="h-4 w-4" /> Control center</div>
            <h1 className="mt-2 font-display text-3xl font-700 text-ink-900">Quiz dashboard</h1>
            <p className="mt-1 text-sm text-ink-500">Create quizzes, load questions, approve participants, and monitor submissions.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadQuizzes} className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-600 text-ink-700 hover:bg-ink-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-600 text-white hover:bg-primary-700"><Plus className="h-4 w-4" /> New quiz</button>
          </div>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Summary label="Total quizzes" value={quizzes.length} icon={FileText} />
          <Summary label="Waiting rooms" value={waitingCount} icon={Users} />
          <Summary label="Live now" value={activeCount} icon={Radio} />
          <Summary label="Attending" value={totalInProgress} icon={MonitorPlay} />
          <Summary label="Rejoin pending" value={totalRejoinPending} icon={RotateCw} highlight={totalRejoinPending > 0} />
        </div>

        <div className="mt-7 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-700 text-ink-900">Your quizzes</h2><span className="text-xs text-ink-400">{quizzes.length} total</span></div>
            {loading ? <div className="flex justify-center rounded-2xl border border-ink-200 bg-white py-12"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div> : quizzes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-ink-200 bg-white p-6 text-center"><FileText className="mx-auto h-8 w-8 text-ink-300" /><p className="mt-2 text-sm font-600 text-ink-700">No quizzes yet</p><p className="mt-1 text-xs text-ink-400">Create your first quiz to begin.</p></div>
            ) : <div className="space-y-3">{quizzes.map((quiz) => {
              const stats = liveStats[quiz.id];
              return <QuizCard key={quiz.id} quiz={quiz} selected={selected?.id === quiz.id} liveInProgress={stats?.inProgress ?? 0} liveRejoin={stats?.rejoinPending ?? 0} onClick={() => { setSelected(quiz); setPanel('questions'); }} />;
            })}</div>}
          </section>

          <section className="min-w-0">
            {!selected ? <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center"><div><Settings2 className="mx-auto h-9 w-9 text-ink-300" /><h2 className="mt-3 font-display text-xl font-700 text-ink-800">Select a quiz</h2><p className="mt-1 text-sm text-ink-500">Choose a quiz from the list to manage its questions and participants.</p></div></div> : <QuizWorkspace quiz={selected} panel={panel} setPanel={setPanel} onStatus={changeStatus} onRegenerate={regenerateCode} onCopy={copyCode} onQuestionsChanged={loadQuizzes} onEvaluationMode={changeEvaluationMode} onDurationChange={async (mins) => { const r = await updateQuizDuration(selected.id, mins); if (r.error) { toast.show(r.error, 'error'); return; } toast.show('Duration updated.', 'success'); await loadQuizzes(); }} onEditFields={() => setShowEditFields(true)} onDelete={() => setDeleteTarget(selected)} />}
          </section>
        </div>
      </main>
      <CreateQuizModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={loadQuizzes} />
      {selected && showEditFields && <EditFieldsModal quizId={selected.id} quizTitle={selected.title} fields={selected.participantFields} onClose={() => setShowEditFields(false)} onSaved={loadQuizzes} />}
      <StartQuizModal quiz={startModal} onConfirm={handleStartWithDevice} onCancel={() => setStartModal(null)} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete quiz"
        message={<>This will permanently delete <strong>{deleteTarget?.title}</strong> and all its questions, participant registrations, responses, and evaluations. This cannot be undone.</>}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      {joinNotification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-start gap-3 rounded-xl border border-primary-200 bg-white px-4 py-3 shadow-lg" role="alert">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${joinNotification.type === 'rejoin' ? 'bg-warning-500/10 text-warning-500' : 'bg-primary-50 text-primary-600'}`}>
            {joinNotification.type === 'rejoin' ? <RotateCw className="h-5 w-5" /> : <Users className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <p className="text-sm font-600 text-ink-900">{joinNotification.name}</p>
            <p className="text-xs text-ink-500">{joinNotification.type === 'rejoin' ? 'Rejoin request' : 'New registration'} in {joinNotification.quizTitle}</p>
          </div>
          <button onClick={() => setJoinNotification(null)} className="text-ink-400 hover:text-ink-600"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function MonitorPlay({ className }: { className?: string }) {
  return <MonitorSmartphone className={className} />;
}

function Summary({ label, value, icon: Icon, highlight }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; highlight?: boolean }) {
  return <div className={`rounded-2xl border p-5 shadow-[0_1px_2px_rgba(16,20,28,0.04)] ${highlight ? 'border-warning-500/40 bg-warning-500/5' : 'border-ink-200/70 bg-white'}`}><div className={`grid h-9 w-9 place-items-center rounded-xl ${highlight ? 'bg-warning-500/10 text-warning-500' : 'bg-primary-50 text-primary-600'}`}><Icon className="h-5 w-5" /></div><p className="mt-3 font-display text-3xl font-700 text-ink-900">{value}</p><p className="text-sm text-ink-500">{label}</p></div>;
}

function QuizCard({ quiz, selected, liveInProgress, liveRejoin, onClick }: { quiz: QuizRecord; selected: boolean; liveInProgress: number; liveRejoin: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full rounded-2xl border p-4 text-left transition ${selected ? 'border-primary-400 bg-primary-50/60 shadow-[0_4px_14px_rgba(37,70,235,0.1)]' : 'border-ink-200/70 bg-white hover:border-primary-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-600 text-ink-900">{quiz.title}</p>
          <p className="mt-1 text-xs text-ink-500">{quiz.date} · {quiz.numQuestions} questions</p>
        </div>
        <Status status={quiz.status} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="flex items-center gap-1 text-xs font-600 tracking-wide text-primary-600"><span>{quiz.code}</span></p>
        {quiz.status === 'LIVE' && (liveInProgress > 0 || liveRejoin > 0) && (
          <div className="flex gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-600 text-success-500"><MonitorSmartphone className="h-3 w-3" />{liveInProgress}</span>
            {liveRejoin > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-warning-500/10 px-2 py-0.5 text-[10px] font-600 text-warning-500"><RotateCw className="h-3 w-3" />{liveRejoin}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

function QuizWorkspace({ quiz, panel, setPanel, onStatus, onRegenerate, onCopy, onQuestionsChanged, onEvaluationMode, onDurationChange, onEditFields, onDelete }: { quiz: QuizRecord; panel: Panel; setPanel: (p: Panel) => void; onStatus: (status: string) => void; onRegenerate: () => void; onCopy: () => void; onQuestionsChanged: () => void; onEvaluationMode: (mode: 'manual' | 'auto') => void; onDurationChange: (minutes: number) => Promise<void>; onEditFields: () => void; onDelete: () => void; }) {
  const tabs: { key: Panel; label: string; icon: React.ComponentType<{ className?: string }> }[] = [{ key: 'questions', label: 'Questions', icon: FileText }, { key: 'monitor', label: 'Participants', icon: Users }, { key: 'evaluation', label: 'Evaluation', icon: Trophy }, { key: 'results', label: 'Results', icon: Trophy }];
  const nextStatus = quiz.status === 'DRAFT' ? 'WAITING' : quiz.status === 'WAITING' ? 'LIVE' : quiz.status === 'LIVE' ? 'STOPPED' : quiz.status === 'STOPPED' ? 'COMPLETED' : null;
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationValue, setDurationValue] = useState(quiz.durationMinutes);

  useEffect(() => { setDurationValue(quiz.durationMinutes); }, [quiz.durationMinutes]);
  const deviceMode = quiz.deviceMode || 'both';

  async function saveDuration() {
    if (durationValue < 1) return;
    await onDurationChange(durationValue);
    setEditingDuration(false);
  }

  return <div><div className="rounded-2xl border border-ink-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(16,20,28,0.04)]"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="font-display text-xl font-700 text-ink-900">{quiz.title}</h2><Status status={quiz.status} /></div><p className="mt-1 text-sm text-ink-500">{quiz.description || 'No description provided.'}</p></div><div className="flex flex-wrap gap-2">{nextStatus && <button onClick={() => onStatus(nextStatus)} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-600 text-white hover:bg-primary-700">{nextStatus === 'WAITING' ? 'Open registration' : nextStatus === 'LIVE' ? 'Start quiz' : nextStatus === 'STOPPED' ? 'Stop quiz' : 'Complete quiz'}</button>}{quiz.code ? <button onClick={onCopy} className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-600 text-ink-700 hover:bg-ink-50"><Copy className="h-4 w-4" /> {quiz.code}</button> : <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-ink-200 px-3 py-2 text-sm font-500 text-ink-400">No code yet</span>}{quiz.code && <button onClick={onRegenerate} title="Generate a new code" className="rounded-lg border border-ink-200 p-2 text-ink-500 hover:bg-ink-50"><RefreshCw className="h-4 w-4" /></button>}<button onClick={onEditFields} title="Edit participant fields" className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-600 text-ink-700 transition hover:bg-ink-50"><ListChecks className="h-4 w-4" /> Fields</button><button onClick={onDelete} title="Delete quiz" className="flex items-center gap-1.5 rounded-lg border border-danger-500/30 bg-white px-3 py-2 text-sm font-600 text-danger-500 transition hover:bg-danger-500/5"><Trash2 className="h-4 w-4" /> Delete</button></div></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><Meta label="Date" value={quiz.date} /><Meta label="Time" value={`${quiz.startTime} – ${quiz.endTime}`} /><div className="rounded-lg bg-ink-50 px-3 py-2"><p className="text-xs text-ink-400">Duration</p>{editingDuration ? <div className="mt-1 flex items-center gap-1.5"><input type="number" min={1} value={durationValue} onChange={(e) => setDurationValue(parseInt(e.target.value) || 1)} className="w-16 rounded border border-ink-200 px-1.5 py-0.5 text-sm font-600 text-ink-800 outline-none focus:border-primary-400" /><button onClick={saveDuration} className="rounded bg-primary-600 p-1 text-white hover:bg-primary-700"><Save className="h-3.5 w-3.5" /></button><button onClick={() => { setEditingDuration(false); setDurationValue(quiz.durationMinutes); }} className="text-ink-400 hover:text-ink-600"><X className="h-4 w-4" /></button></div> : <div className="mt-0.5 flex items-center gap-1.5"><p className="font-600 text-ink-800">{quiz.durationMinutes} min</p>{quiz.status === 'LIVE' && <button onClick={() => setEditingDuration(true)} title="Edit duration" className="text-ink-400 hover:text-primary-600"><RefreshCw className="h-3.5 w-3.5" /></button>}</div>}</div><Meta label="Questions" value={`${quiz.numQuestions}`} /></div><div className="mt-4 flex items-center gap-2 rounded-lg bg-ink-50 px-4 py-3"><span className="text-sm font-600 text-ink-700">Evaluation:</span><div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-0.5"><button onClick={() => onEvaluationMode('manual')} className={`rounded-md px-3 py-1 text-xs font-600 transition ${quiz.evaluationMode === 'manual' ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'}`}>Manual</button><button onClick={() => onEvaluationMode('auto')} className={`rounded-md px-3 py-1 text-xs font-600 transition ${quiz.evaluationMode === 'auto' ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'}`}>AI Auto-Evaluate</button></div><span className="text-xs text-ink-400">{quiz.evaluationMode === 'auto' ? 'Automatically grade and rank all participants' : 'Admin reviews and scores manually'}</span></div>{quiz.status === 'LIVE' && <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary-50 px-4 py-2.5"><span className="text-sm font-600 text-primary-700">Device mode:</span><DeviceBadge mode={deviceMode} /></div>}</div><div className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-ink-200 bg-white p-1">{tabs.map((tab) => <button key={tab.key} onClick={() => setPanel(tab.key)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-600 ${panel === tab.key ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'}`}><tab.icon className="h-4 w-4" /> {tab.label}</button>)}</div><div className="mt-5">{panel === 'questions' && <QuestionManager quizId={quiz.id} expectedCount={quiz.numQuestions} onQuestionsChanged={onQuestionsChanged} />}{panel === 'monitor' && <QuizMonitor quizId={quiz.id} quizStatus={quiz.status} numQuestions={quiz.numQuestions} />}{panel === 'evaluation' && <EvaluationPanel quizId={quiz.id} participants={[]} evaluationMode={quiz.evaluationMode} />}{panel === 'results' && <ResultsPanel quizId={quiz.id} quizTitle={quiz.title} />}</div></div>;
}

function StartQuizModal({ quiz, onConfirm, onCancel }: { quiz: QuizRecord | null; onConfirm: (mode: DeviceMode) => void; onCancel: () => void; }) {
  const [mode, setMode] = useState<DeviceMode>('both');
  useEffect(() => { if (quiz) setMode(quiz.deviceMode || 'both'); }, [quiz]);
  if (!quiz) return null;
  const options: { value: DeviceMode; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'laptop', label: 'Laptop only', desc: 'Fullscreen enforced. Tab switching auto-submits.', icon: Monitor },
    { value: 'mobile', label: 'Mobile only', desc: 'Fullscreen enforced. Circle to Search blocked.', icon: Smartphone },
    { value: 'both', label: 'Both devices', desc: 'Standard restrictions apply.', icon: MonitorSmartphone },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-700 text-ink-900">Start Quiz</h2>
          <button onClick={onCancel} className="text-ink-400 hover:text-ink-600"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-2 text-sm text-ink-500">Choose which devices participants can use for "{quiz.title}".</p>
        <div className="mt-5 space-y-3">
          {options.map((opt) => (
            <button key={opt.value} onClick={() => setMode(opt.value)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${mode === opt.value ? 'border-primary-500 bg-primary-50' : 'border-ink-200 hover:border-primary-300'}`}>
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${mode === opt.value ? 'bg-primary-600 text-white' : 'bg-ink-100 text-ink-600'}`}><opt.icon className="h-5 w-5" /></div>
              <div><p className="font-600 text-ink-900">{opt.label}</p><p className="mt-0.5 text-xs text-ink-500">{opt.desc}</p></div>
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-600 text-ink-700 hover:bg-ink-50">Cancel</button>
          <button onClick={() => onConfirm(mode)} className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-600 text-white hover:bg-primary-700"><Radio className="h-4 w-4" /> Start quiz</button>
        </div>
      </div>
    </div>
  );
}

function DeviceBadge({ mode }: { mode: DeviceMode }) {
  const map: Record<DeviceMode, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
    laptop: { label: 'Laptop only', icon: Monitor, color: 'bg-primary-100 text-primary-700' },
    mobile: { label: 'Mobile only', icon: Smartphone, color: 'bg-accent-100 text-accent-700' },
    both: { label: 'Both devices', icon: MonitorSmartphone, color: 'bg-ink-100 text-ink-600' },
  };
  const info = map[mode] || map.both;
  const Icon = info.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-600 ${info.color}`}><Icon className="h-3.5 w-3.5" /> {info.label}</span>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-ink-50 px-3 py-2"><p className="text-xs text-ink-400">{label}</p><p className="mt-0.5 font-600 text-ink-800">{value}</p></div>; }
function Status({ status }: { status: string }) { const colors: Record<string, string> = { DRAFT: 'bg-ink-100 text-ink-600', WAITING: 'bg-warning-500/10 text-warning-500', LIVE: 'bg-success-500/10 text-success-500', STOPPED: 'bg-danger-500/10 text-danger-500', COMPLETED: 'bg-primary-50 text-primary-700' }; return <span className={`rounded-full px-2 py-0.5 text-[11px] font-700 ${colors[status] || 'bg-ink-100 text-ink-600'}`}>{status}</span>; }

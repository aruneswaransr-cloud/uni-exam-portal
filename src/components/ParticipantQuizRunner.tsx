import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, Maximize2, Send, ShieldAlert, WifiOff, Monitor, Smartphone, MonitorOff } from 'lucide-react';
import { heartbeat, saveResponse, startAttempt, submitAttempt, getParticipantStatus, type QuizQuestion } from '@/services/quizApi';
import { useToast } from '@/components/Toast';

interface ParticipantQuizRunnerProps {
  participantId: string;
  onSubmitted: () => void;
}

type DeviceMode = 'laptop' | 'mobile' | 'both';
type PhysicalDevice = 'desktop' | 'mobile';

function detectPhysicalDevice(): PhysicalDevice {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  // Mobile phones: iPhone, Android phones, Windows Phone, etc.
  // iPads/tablets are treated as mobile for restriction purposes.
  const isMobileUA = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop|BlackBerry|webOS|Mobile|Tablet/i.test(ua);
  // Desktop: Mac, Windows, Linux without mobile UA
  if (isMobileUA) return 'mobile';
  return 'desktop';
}

export function ParticipantQuizRunner({ participantId, onSubmitted }: ParticipantQuizRunnerProps) {
  const { show: showToast } = useToast();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitReason, setSubmitReason] = useState<string | null>(null);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('both');
  const [needsFullscreen, setNeedsFullscreen] = useState(false);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const current = questions[index];

  // Refs to avoid stale closures in the polling interval
  const attemptStartedAtRef = useRef(0);
  const durationMinutesRef = useRef(0);
  const submittedRef = useRef(false);
  const deviceModeRef = useRef<DeviceMode>('both');

  const finish = useCallback(async (reason: 'manual' | 'timeout' | 'tab_switch' | 'network_lost' | 'admin_stopped' | 'fullscreen_exit') => {
    if (!attemptId || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    setSubmitReason(reason);
    const result = await submitAttempt(attemptId, reason);
    if (!result.ok && reason === 'manual') {
      submittedRef.current = false;
      setSubmitted(false);
      showToast(result.error || 'Could not submit the quiz.', 'error');
    }
  }, [attemptId, showToast]);

  useEffect(() => {
    let active = true;
    startAttempt(participantId).then((result) => {
      if (!active) return;
      if (!result.ok || !result.attempt || !result.questions || !result.quiz) {
        showToast(result.error || 'Unable to start the quiz.', 'error');
        setLoading(false);
        return;
      }

      const mode = (result.quiz.device_mode as DeviceMode) || 'both';

      // Device restriction check — BEFORE setting any state that triggers timers
      const physical = detectPhysicalDevice();
      if (mode === 'laptop' && physical === 'mobile') {
        setDeviceMode(mode);
        setDeviceBlocked(true);
        setLoading(false);
        return;
      }
      if (mode === 'mobile' && physical === 'desktop') {
        setDeviceMode(mode);
        setDeviceBlocked(true);
        setLoading(false);
        return;
      }

      const started = new Date(result.attempt.started_at).getTime();
      attemptStartedAtRef.current = started;
      durationMinutesRef.current = result.quiz.duration_minutes;

      setAttemptId(result.attempt.id);
      setQuestions(result.questions);
      setIndex(result.attempt.current_index || 0);
      setDeviceMode(mode);
      const end = started + result.quiz.duration_minutes * 60_000;
      setSecondsLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
      setLoading(false);
    });
    return () => { active = false; };
  }, [participantId, showToast]);

  // Request fullscreen on load for laptop/mobile modes
  useEffect(() => {
    if (loading || submitted || !attemptId) return;
    if (deviceMode === 'both') return;

    const requestFs = () => {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if ((el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen) (el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen!();
    };
    requestFs();

    const onFsChange = () => {
      if (!document.fullscreenElement && !submitted) {
        setNeedsFullscreen(true);
      } else if (document.fullscreenElement) {
        setNeedsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [deviceMode, loading, attemptId, submitted]);

  // Timer + heartbeat
  useEffect(() => {
    if (!attemptId || submitted) return;
    const interval = window.setInterval(() => {
      heartbeat(attemptId);
      setSecondsLeft((value) => {
        if (value <= 1) {
          void finish('timeout');
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [attemptId, submitted, finish]);

  // Poll quiz status — auto-submit when admin stops/completes, and live-sync duration
  useEffect(() => {
    if (!attemptId || submitted) return;
    let active = true;
    const interval = window.setInterval(async () => {
      const data = await getParticipantStatus(participantId);
      if (!active || !data || !data.ok || !data.quiz) return;
      if (data.quiz.status === 'STOPPED' || data.quiz.status === 'COMPLETED') {
        void finish('admin_stopped');
        return;
      }
      // Live duration update — use refs so we always have the latest values
      const newDuration = data.quiz.duration_minutes as number;
      if (newDuration && newDuration !== durationMinutesRef.current) {
        durationMinutesRef.current = newDuration;
        const end = attemptStartedAtRef.current + newDuration * 60_000;
        setSecondsLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
      }
      // Live device mode update
      const newDeviceMode = (data.quiz.device_mode as DeviceMode) || 'both';
      if (newDeviceMode !== deviceModeRef.current) {
        deviceModeRef.current = newDeviceMode;
        setDeviceMode(newDeviceMode);
      }
    }, 3000);
    return () => { active = false; window.clearInterval(interval); };
  }, [attemptId, submitted, participantId, finish]);

  // Anti-cheat: device-specific restrictions
  useEffect(() => {
    if (!attemptId || submitted) return;
    if (deviceMode === 'both') {
      const submitForViolation = () => { void finish('tab_switch'); };
      const blockClipboard = (event: ClipboardEvent) => event.preventDefault();
      const blockContext = (event: MouseEvent) => event.preventDefault();
      const blockSelection = (event: Event) => event.preventDefault();
      const handleOffline = () => { void finish('network_lost'); };
      document.addEventListener('visibilitychange', submitForViolation);
      window.addEventListener('blur', submitForViolation);
      window.addEventListener('offline', handleOffline);
      document.addEventListener('copy', blockClipboard);
      document.addEventListener('cut', blockClipboard);
      document.addEventListener('paste', blockClipboard);
      document.addEventListener('contextmenu', blockContext);
      document.addEventListener('selectstart', blockSelection);
      return () => {
        document.removeEventListener('visibilitychange', submitForViolation);
        window.removeEventListener('blur', submitForViolation);
        window.removeEventListener('offline', handleOffline);
        document.removeEventListener('copy', blockClipboard);
        document.removeEventListener('cut', blockClipboard);
        document.removeEventListener('paste', blockClipboard);
        document.removeEventListener('contextmenu', blockContext);
        document.removeEventListener('selectstart', blockSelection);
      };
    }

    if (deviceMode === 'laptop') {
      const submitForViolation = () => {
        if (document.hidden) void finish('tab_switch');
      };
      const onBlur = () => { void finish('tab_switch'); };
      const blockClipboard = (event: ClipboardEvent) => event.preventDefault();
      const blockContext = (event: MouseEvent) => event.preventDefault();
      const blockSelection = (event: Event) => event.preventDefault();
      const handleOffline = () => { void finish('network_lost'); };
      document.addEventListener('visibilitychange', submitForViolation);
      window.addEventListener('blur', onBlur);
      window.addEventListener('offline', handleOffline);
      document.addEventListener('copy', blockClipboard);
      document.addEventListener('cut', blockClipboard);
      document.addEventListener('paste', blockClipboard);
      document.addEventListener('contextmenu', blockContext);
      document.addEventListener('selectstart', blockSelection);
      return () => {
        document.removeEventListener('visibilitychange', submitForViolation);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('offline', handleOffline);
        document.removeEventListener('copy', blockClipboard);
        document.removeEventListener('cut', blockClipboard);
        document.removeEventListener('paste', blockClipboard);
        document.removeEventListener('contextmenu', blockContext);
        document.removeEventListener('selectstart', blockSelection);
      };
    }

    if (deviceMode === 'mobile') {
      const submitForViolation = () => {
        if (document.hidden) void finish('tab_switch');
      };
      const onBlur = () => {
        setTimeout(() => {
          if (!document.hasFocus() && !submittedRef.current) void finish('tab_switch');
        }, 100);
      };
      const blockContext = (event: MouseEvent) => event.preventDefault();
      const blockSelection = (event: Event) => event.preventDefault();
      const blockTouchCallout = (event: Event) => event.preventDefault();
      const handleOffline = () => { void finish('network_lost'); };
      document.addEventListener('visibilitychange', submitForViolation);
      window.addEventListener('blur', onBlur);
      window.addEventListener('offline', handleOffline);
      document.addEventListener('contextmenu', blockContext);
      document.addEventListener('selectstart', blockSelection);
      document.addEventListener('touchstart', blockTouchCallout, { passive: false });
      document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) e.preventDefault();
      }, { passive: false });
      return () => {
        document.removeEventListener('visibilitychange', submitForViolation);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('offline', handleOffline);
        document.removeEventListener('contextmenu', blockContext);
        document.removeEventListener('selectstart', blockSelection);
        document.removeEventListener('touchstart', blockTouchCallout);
      };
    }
  }, [attemptId, submitted, finish, deviceMode]);

  async function choose(option: string) {
    if (!attemptId || !current || submitted) return;
    setAnswers((old) => ({ ...old, [current.id]: option }));
    const result = await saveResponse(attemptId, current.id, option, index);
    if (!result.ok && !result.submitted) showToast(result.error || 'Answer could not be saved.', 'error');
  }

  const formattedTime = useMemo(() => `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`, [secondsLeft]);

  if (loading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>;

  if (deviceBlocked) {
    const physical = detectPhysicalDevice();
    const expectedDevice = deviceMode === 'laptop' ? 'a laptop or computer' : 'a mobile phone';
    const yourDevice = physical === 'mobile' ? 'a mobile phone' : 'a laptop or computer';
    return (
      <div className="rounded-2xl border border-danger-500/30 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-danger-500/10 text-danger-500">
          <MonitorOff className="h-7 w-7" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">Device not allowed</h1>
        <p className="mt-2 text-sm text-ink-500">
          This quiz is restricted to {expectedDevice}. You are using {yourDevice}.
          Please switch to {expectedDevice} and rejoin the quiz.
        </p>
      </div>
    );
  }

  if (needsFullscreen && !submitted) {
    return (
      <div className="rounded-2xl border border-warning-500/30 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-warning-500/10 text-warning-500">
          <Maximize2 className="h-7 w-7" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">Fullscreen required</h1>
        <p className="mt-2 text-sm text-ink-500">You exited fullscreen mode. Please re-enter fullscreen to continue the quiz.</p>
        <button
          onClick={() => {
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
            else if ((el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen) (el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen!();
          }}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-600 text-white hover:bg-primary-700"
        >
          <Maximize2 className="h-4 w-4" /> Re-enter fullscreen
        </button>
      </div>
    );
  }

  if (submitted) {
    const stopped = submitReason === 'admin_stopped';
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
        <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${stopped ? 'bg-warning-500/10 text-warning-500' : 'bg-success-500/10 text-success-500'}`}>
          {stopped ? <ShieldAlert className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
        </div>
        <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">{stopped ? 'Quiz ended' : 'Quiz submitted'}</h1>
        <p className="mt-2 text-sm text-ink-500">
          {stopped
            ? 'The quiz has been ended by the admin. Your answers have been submitted.'
            : submitReason === 'timeout'
              ? 'Time is up. Your answers have been submitted automatically.'
              : `Your answers were submitted automatically${submitReason === 'tab_switch' ? ' because you left the quiz page.' : submitReason === 'network_lost' ? ' because the network connection was lost.' : submitReason === 'fullscreen_exit' ? ' because you exited fullscreen.' : '.'}`}
        </p>
      </div>
    );
  }
  if (!current) return <div className="rounded-2xl border border-danger-500/30 bg-white p-8 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-danger-500" /><p className="mt-3 text-sm text-danger-500">No questions are available for this quiz.</p></div>;

  const deviceLabel = deviceMode === 'laptop' ? 'Laptop mode' : deviceMode === 'mobile' ? 'Mobile mode' : 'Standard mode';
  const DeviceIcon = deviceMode === 'laptop' ? Monitor : deviceMode === 'mobile' ? Smartphone : ShieldAlert;

  return <div className="select-none" onCopy={(event) => event.preventDefault()} onPaste={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}>
    <div className="mb-4 flex items-center justify-between rounded-2xl border border-ink-200 bg-white px-4 py-3 shadow-sm"><div><p className="text-xs font-600 uppercase tracking-wide text-primary-600">Question {index + 1} of {questions.length}</p><p className="mt-1 text-sm text-ink-500">{Object.keys(answers).length} answered</p></div><div className="flex items-center gap-3"><div className="hidden items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs font-600 text-ink-600 sm:flex"><DeviceIcon className="h-3.5 w-3.5" /> {deviceLabel}</div><div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-700 ${secondsLeft < 60 ? 'bg-danger-500/10 text-danger-500' : 'bg-primary-50 text-primary-700'}`}><Clock className="h-4 w-4" /> {formattedTime}</div></div></div>
    <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-600 text-sm font-700 text-white">{index + 1}</span><h1 className="font-display text-xl font-700 leading-snug text-ink-900">{current.text}</h1></div><div className="mt-6 grid gap-3">{(['A', 'B', 'C', 'D'] as const).map((option) => { const text = option === 'A' ? current.option_a : option === 'B' ? current.option_b : option === 'C' ? current.option_c : current.option_d; const selected = answers[current.id] === option; return <button key={option} onClick={() => choose(option)} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${selected ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-ink-200 text-ink-700 hover:border-primary-300 hover:bg-primary-50/40'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-700 ${selected ? 'bg-primary-600 text-white' : 'bg-ink-100 text-ink-600'}`}>{option}</span><span className="pt-0.5">{text}</span></button>; })}</div><div className="mt-7 flex items-center justify-between gap-3 border-t border-ink-100 pt-4"><button onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-600 text-ink-700 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>{index === questions.length - 1 ? <button onClick={() => void finish('manual')} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-600 text-white hover:bg-primary-700"><Send className="h-4 w-4" /> Submit quiz</button> : <button onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-600 text-white hover:bg-primary-700">Next <ChevronRight className="h-4 w-4" /></button>}</div></div><div className="mt-4 flex items-center justify-center gap-2 text-xs text-ink-400"><ShieldAlert className="h-4 w-4" /> {deviceMode === 'laptop' ? 'Fullscreen is locked. Tab switching will auto-submit your quiz.' : deviceMode === 'mobile' ? 'Fullscreen is locked. Exiting the app or Circle to Search will auto-submit your quiz.' : 'Tab switching, copy/paste, and leaving the page are disabled.'}</div></div>;
}

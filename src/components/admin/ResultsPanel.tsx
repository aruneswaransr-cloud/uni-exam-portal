import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Download, Trophy, Award, FileText, FileSpreadsheet, FileType, Sparkles, Users, Clock, Upload, Link2, X, CheckCircle2, KeyRound, Zap } from 'lucide-react';
import { getResults, uploadAnswerKey, autoEvaluateQuiz } from '@/services/adminApi';
import { exportReportToExcel, exportReportToWord, exportReportToPDF, parseAnswerKeyFile, parseAnswerKeyText, type ReportRow, type AnswerKeyEntry } from '@/lib/questionParser';
import { useToast } from '@/components/Toast';

interface ResultRow {
  participant_id: string;
  full_name: string;
  email: string;
  phone: string;
  register_number: string;
  department: string;
  quiz_title: string;
  total_marks: number;
  marks_obtained: number;
  answered_count: number;
  total_questions: number;
  percentage: number;
  submitted_at: string;
  end_reason: string;
  time_taken_seconds: number | null;
}

interface ResultsPanelProps {
  quizId: string;
  quizTitle: string;
}

type ReportType = 'alphabetical' | 'ranked';
type ExportFormat = 'excel' | 'word' | 'pdf';
type KeyInputMode = 'file' | 'text' | 'link';

export function ResultsPanel({ quizId, quizTitle }: ResultsPanelProps) {
  const toast = useToast();
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportType, setReportType] = useState<ReportType>('alphabetical');

  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [keyMode, setKeyMode] = useState<KeyInputMode>('file');
  const [keyText, setKeyText] = useState('');
  const [keyLink, setKeyLink] = useState('');
  const [keyPreview, setKeyPreview] = useState<AnswerKeyEntry[] | null>(null);
  const [keyParsing, setKeyParsing] = useState(false);
  const [keyUploading, setKeyUploading] = useState(false);
  const [autoEvaluating, setAutoEvaluating] = useState(false);
  const keyFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getResults(quizId);
    setLoading(false);
    if (!res.ok) { toast.show(res.error, 'error'); return; }
    setResults((res.data.results as ResultRow[]) || []);
  }, [quizId, toast]);

  useEffect(() => { load(); }, [load]);

  const alphabeticalRows: ReportRow[] = useMemo(() => {
    return [...results]
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map((r, i) => ({
        rank: i + 1,
        full_name: r.full_name,
        department: r.department,
        marks_obtained: r.marks_obtained,
        total_marks: r.total_marks,
        percentage: r.percentage,
        answered_count: r.answered_count,
        total_questions: r.total_questions,
        submitted_at: r.submitted_at,
        time_taken_seconds: r.time_taken_seconds,
      }));
  }, [results]);

  const rankedRows: ReportRow[] = useMemo(() => {
    return [...results]
      .sort((a, b) => {
        if (b.marks_obtained !== a.marks_obtained) return b.marks_obtained - a.marks_obtained;
        if (a.time_taken_seconds !== null && b.time_taken_seconds !== null) {
          return a.time_taken_seconds - b.time_taken_seconds;
        }
        return 0;
      })
      .map((r, i) => ({
        rank: i + 1,
        full_name: r.full_name,
        department: r.department,
        marks_obtained: r.marks_obtained,
        total_marks: r.total_marks,
        percentage: r.percentage,
        answered_count: r.answered_count,
        total_questions: r.total_questions,
        submitted_at: r.submitted_at,
        time_taken_seconds: r.time_taken_seconds,
      }));
  }, [results]);

  const activeRows = reportType === 'alphabetical' ? alphabeticalRows : rankedRows;

  function handleExport(format: ExportFormat) {
    if (activeRows.length === 0) {
      toast.show('No results to export.', 'error');
      return;
    }
    if (format === 'excel') exportReportToExcel(activeRows, quizTitle, reportType);
    else if (format === 'word') exportReportToWord(activeRows, quizTitle, reportType);
    else exportReportToPDF(activeRows, quizTitle, reportType);
    toast.show(`${format === 'excel' ? 'Excel' : format === 'word' ? 'Word' : 'PDF'} report downloaded.`, 'success');
  }

  async function handleKeyFileUpload(file: File) {
    setKeyParsing(true);
    try {
      const parsed = await parseAnswerKeyFile(file);
      if (parsed.length === 0) {
        toast.show('No answers found in the file. Check the format and try again.', 'error');
        setKeyParsing(false);
        return;
      }
      setKeyPreview(parsed);
      toast.show(`${parsed.length} answers parsed from file. Review and apply.`, 'info');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to parse file.', 'error');
    }
    setKeyParsing(false);
  }

  function handleParseKeyText() {
    if (!keyText.trim()) {
      toast.show('Please paste some answer key text first.', 'error');
      return;
    }
    setKeyParsing(true);
    const parsed = parseAnswerKeyText(keyText);
    setKeyParsing(false);
    if (parsed.length === 0) {
      toast.show('No answers found. Check the format and try again.', 'error');
      return;
    }
    setKeyPreview(parsed);
    toast.show(`${parsed.length} answers detected. Review and apply.`, 'info');
  }

  async function handleParseKeyLink() {
    if (!keyLink.trim()) {
      toast.show('Please paste a link first.', 'error');
      return;
    }
    setKeyParsing(true);
    try {
      const url = keyLink.trim();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch the link (status ${res.status}).`);
      const ct = res.headers.get('content-type') || '';
      let text: string;
      if (ct.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
        const blob = await res.blob();
        const parsed = await parseAnswerKeyFile(new File([blob], 'key.pdf'));
        setKeyPreview(parsed);
        toast.show(`${parsed.length} answers parsed from PDF link.`, 'info');
        setKeyParsing(false);
        return;
      }
      text = await res.text();
      const parsed = parseAnswerKeyText(text);
      if (parsed.length === 0) throw new Error('No answers found at that link.');
      setKeyPreview(parsed);
      toast.show(`${parsed.length} answers parsed from link.`, 'info');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to fetch link.', 'error');
    }
    setKeyParsing(false);
  }

  async function handleApplyAnswerKey() {
    if (!keyPreview || keyPreview.length === 0) return;
    setKeyUploading(true);
    const result = await uploadAnswerKey(quizId, keyPreview);
    setKeyUploading(false);
    if (!result.ok) { toast.show(result.error, 'error'); return; }
    toast.show(`Answer key applied — ${result.data.updated} questions updated, ${result.data.skipped} skipped.`, 'success');
    setKeyPreview(null);
    setKeyText('');
    setKeyLink('');
    setShowAnswerKey(false);
  }

  async function handleAutoEvaluate() {
    setAutoEvaluating(true);
    const result = await autoEvaluateQuiz(quizId);
    setAutoEvaluating(false);
    if (result.error) { toast.show(result.error, 'error'); return; }
    toast.show(`Auto-evaluated ${result.data?.evaluated_responses ?? 0} responses for ${result.data?.total_participants ?? 0} participants.`, 'success');
    await load();
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>;
  }

  if (results.length === 0) {
    return (
      <div>
        <h3 className="font-display text-lg font-700 text-ink-900">Results & Ranking</h3>
        <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-white py-12 text-center">
          <FileText className="h-8 w-8 text-ink-300" />
          <p className="mt-2 text-sm font-500 text-ink-500">No evaluated results yet</p>
          <p className="text-xs text-ink-400">Evaluate participants first, then results and rankings will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-700 text-ink-900">Results & Ranking</h3>
          <p className="mt-1 text-sm text-ink-500">{results.length} participants completed this quiz.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowAnswerKey((s) => !s)} className="flex items-center gap-1.5 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-sm font-600 text-accent-700 transition hover:bg-accent-100">
            <KeyRound className="h-4 w-4" /> Answer Key
          </button>
          <button onClick={handleAutoEvaluate} disabled={autoEvaluating} className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-600 text-primary-700 transition hover:bg-primary-100 disabled:opacity-60">
            {autoEvaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Re-evaluate
          </button>
          <button onClick={() => handleExport('excel')} className="flex items-center gap-1.5 rounded-lg bg-success-500 px-3 py-2 text-sm font-600 text-white transition hover:bg-success-500/90">
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
          <button onClick={() => handleExport('word')} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-600 text-white transition hover:bg-primary-700">
            <FileType className="h-4 w-4" /> Word
          </button>
          <button onClick={() => handleExport('pdf')} className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-600 text-ink-700 transition hover:bg-ink-50">
            <Download className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      {/* Answer Key upload panel */}
      {showAnswerKey && (
        <div className="mt-5 rounded-2xl border border-accent-200 bg-accent-50/30 p-5 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-accent-600" />
              <h4 className="font-600 text-ink-900">Upload Answer Key</h4>
            </div>
            <button onClick={() => { setShowAnswerKey(false); setKeyPreview(null); }} className="text-ink-400 hover:text-ink-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-500">Upload or paste the correct answers to update the answer key. Then re-evaluate to recalculate all scores automatically.</p>

          {/* Input mode tabs */}
          <div className="mt-4 flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
            {([
              { key: 'file' as const, label: 'Upload File', icon: Upload },
              { key: 'text' as const, label: 'Paste Text', icon: Link2 },
              { key: 'link' as const, label: 'Paste Link', icon: Link2 },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setKeyMode(tab.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-600 transition ${
                  keyMode === tab.key ? 'bg-white text-accent-700 shadow-sm' : 'text-ink-500 hover:text-ink-900'
                }`}
              >
                <tab.icon className="h-4 w-4" /> {tab.label}
              </button>
            ))}
          </div>

          {/* File upload */}
          {keyMode === 'file' && (
            <div className="mt-4">
              <div
                onClick={() => keyFileRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 px-6 py-10 text-center transition hover:border-accent-300 hover:bg-accent-50"
              >
                {keyParsing ? (
                  <Loader2 className="h-8 w-8 animate-spin text-accent-600" />
                ) : (
                  <Upload className="h-8 w-8 text-ink-400" />
                )}
                <p className="mt-3 text-sm font-500 text-ink-700">Click to upload an answer key file</p>
                <p className="mt-1 text-xs text-ink-400">Supports PDF, Word (.docx), Excel (.xlsx), CSV, and text files.</p>
                <input
                  ref={keyFileRef}
                  type="file"
                  accept=".txt,.docx,.pdf,.xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleKeyFileUpload(f);
                  }}
                />
              </div>
            </div>
          )}

          {/* Paste text */}
          {keyMode === 'text' && (
            <div className="mt-4">
              <textarea
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
                placeholder={`1. A\n2. C\n3. B\n4. D\n\nor:\nQ1: A\nQ2: C\nQ3: B\nQ4: D\n\nor just:\nA\nC\nB\nD`}
              />
              <button
                onClick={handleParseKeyText}
                disabled={keyParsing}
                className="mt-3 flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-600 text-ink-700 hover:bg-ink-50"
              >
                {keyParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Parse Answers
              </button>
            </div>
          )}

          {/* Paste link */}
          {keyMode === 'link' && (
            <div className="mt-4">
              <div className="flex gap-2">
                <input
                  value={keyLink}
                  onChange={(e) => setKeyLink(e.target.value)}
                  className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
                  placeholder="https://example.com/answer-key.pdf"
                />
                <button
                  onClick={handleParseKeyLink}
                  disabled={keyParsing}
                  className="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-600 text-white hover:bg-accent-700 disabled:opacity-60"
                >
                  {keyParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Fetch
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-400">Paste a direct link to a PDF, text file, or web page containing the answer key.</p>
            </div>
          )}

          {/* Preview */}
          {keyPreview && (
            <div className="mt-4 rounded-xl border border-accent-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-600 text-accent-700">
                  <CheckCircle2 className="h-4 w-4" /> {keyPreview.length} answers detected
                </span>
                <button onClick={() => setKeyPreview(null)} className="text-ink-400 hover:text-ink-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {keyPreview.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-3 py-1.5 text-sm">
                    <span className="text-xs font-600 text-ink-500">Q{a.position ?? (i + 1)}</span>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-success-500 text-xs font-700 text-white">{a.correct_option}</span>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleApplyAnswerKey}
                  disabled={keyUploading}
                  className="flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-2 text-sm font-600 text-white hover:bg-accent-700 disabled:opacity-60"
                >
                  {keyUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Apply Answer Key
                </button>
                <button
                  onClick={async () => { await handleApplyAnswerKey(); await handleAutoEvaluate(); }}
                  disabled={keyUploading || autoEvaluating}
                  className="flex items-center gap-2 rounded-lg border border-primary-300 bg-primary-50 px-5 py-2 text-sm font-600 text-primary-700 hover:bg-primary-100 disabled:opacity-60"
                >
                  {(keyUploading || autoEvaluating) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Apply & Re-evaluate
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Report type toggle */}
      <div className="mt-5 flex gap-1 rounded-xl border border-ink-200 bg-white p-1">
        <button
          onClick={() => setReportType('alphabetical')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-600 transition ${reportType === 'alphabetical' ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'}`}
        >
          <Users className="h-4 w-4" /> Alphabetical Report
        </button>
        <button
          onClick={() => setReportType('ranked')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-600 transition ${reportType === 'ranked' ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'}`}
        >
          <Sparkles className="h-4 w-4" /> AI Ranked Report
        </button>
      </div>

      {/* Podium (top 3) - only for ranked report */}
      {reportType === 'ranked' && rankedRows.length >= 1 && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {rankedRows.slice(0, 3).map((r, i) => (
            <div
              key={r.full_name + i}
              className={`rounded-2xl border p-4 text-center shadow-[0_1px_2px_rgba(16,20,28,0.04)] ${i === 0 ? 'border-warning-500/30 bg-warning-500/5' : 'border-ink-200 bg-white'}`}
            >
              <div className={`mx-auto grid h-10 w-10 place-items-center rounded-full ${i === 0 ? 'bg-warning-500 text-white' : i === 1 ? 'bg-ink-300 text-white' : 'bg-ink-400 text-white'}`}>
                {i === 0 ? <Trophy className="h-5 w-5" /> : <Award className="h-5 w-5" />}
              </div>
              <p className="mt-2 text-xs font-600 text-ink-500">Rank {i + 1}</p>
              <p className="mt-0.5 font-600 text-ink-900">{r.full_name}</p>
              <p className="text-xs text-ink-500">{r.department || 'N/A'}</p>
              <p className="mt-2 font-display text-xl font-700 text-primary-600">
                {r.marks_obtained} <span className="text-sm font-500 text-ink-400">/ {r.total_marks}</span>
              </p>
              <p className="text-xs font-600 text-accent-600">{r.percentage}%</p>
              {r.time_taken_seconds !== null && (
                <p className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-400">
                  <Clock className="h-3 w-3" /> {Math.floor(r.time_taken_seconds / 60)}m {r.time_taken_seconds % 60}s
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Summary bar */}
      <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl bg-primary-50 px-5 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary-600" />
          <span className="text-sm font-600 text-primary-700">{activeRows.length} participants</span>
        </div>
        <div className="h-4 w-px bg-primary-200" />
        <span className="text-sm text-ink-500">
          {reportType === 'alphabetical'
            ? 'Ordered alphabetically by name'
            : 'Ordered by score — ties broken by fastest completion time'}
        </span>
      </div>

      {/* Full table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs font-600 uppercase text-ink-500">
              <th className="px-4 py-3">{reportType === 'alphabetical' ? '#' : 'Rank'}</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Answered</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">%</th>
              {reportType === 'ranked' && <th className="hidden px-4 py-3 sm:table-cell">Time Taken</th>}
              <th className="hidden px-4 py-3 md:table-cell">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map((r, i) => (
              <tr key={r.full_name + i} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/50">
                <td className="px-4 py-3">
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-700 ${reportType === 'ranked' && i === 0 ? 'bg-warning-500/10 text-warning-500' : 'bg-ink-100 text-ink-600'}`}>
                    {reportType === 'alphabetical' ? i + 1 : r.rank}
                  </span>
                </td>
                <td className="px-4 py-3 font-600 text-ink-900">{r.full_name}</td>
                <td className="px-4 py-3 text-ink-600">{r.department || 'Not specified'}</td>
                <td className="px-4 py-3 text-ink-600">{r.answered_count} / {r.total_questions}</td>
                <td className="px-4 py-3 font-600 text-ink-900">{r.marks_obtained} / {r.total_marks}</td>
                <td className="px-4 py-3 font-600 text-accent-600">{r.percentage}%</td>
                {reportType === 'ranked' && (
                  <td className="hidden px-4 py-3 text-xs text-ink-500 sm:table-cell">
                    {r.time_taken_seconds !== null ? `${Math.floor(r.time_taken_seconds / 60)}m ${r.time_taken_seconds % 60}s` : '—'}
                  </td>
                )}
                <td className="hidden px-4 py-3 text-xs text-ink-500 md:table-cell">
                  {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

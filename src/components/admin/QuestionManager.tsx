import { useState, useRef, useCallback } from 'react';
import {
  Loader2, Plus, Trash2, Pencil, GripVertical, Upload, FileUp, Link2, X,
  CheckCircle2, AlertCircle, ChevronUp, ChevronDown,
} from 'lucide-react';
import {
  fetchQuestions, addQuestion, bulkAddQuestions, updateQuestion, deleteQuestion, reorderQuestions,
} from '@/services/adminApi';
import { parseQuestionFile, parseQuestionsText, type ParsedQuestion } from '@/lib/questionParser';
import { useToast } from '@/components/Toast';
import type { Question } from '@/types';

interface QuestionManagerProps {
  quizId: string;
  expectedCount: number;
  onQuestionsChanged: () => void;
}

type InputMode = 'manual' | 'file' | 'text';

export function QuestionManager({ quizId, expectedCount, onQuestionsChanged }: QuestionManagerProps) {
  const toast = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('manual');
  const [pastedText, setPastedText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<ParsedQuestion[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Manual add/edit form
  const [mText, setMText] = useState('');
  const [mA, setMA] = useState('');
  const [mB, setMB] = useState('');
  const [mC, setMC] = useState('');
  const [mD, setMD] = useState('');
  const [mMarks, setMMarks] = useState(1);
  const [mCorrect, setMCorrect] = useState<'A' | 'B' | 'C' | 'D' | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchQuestions(quizId);
    setLoading(false);
    if (error) {
      toast.show(error, 'error');
      return;
    }
    setQuestions(data || []);
  }, [quizId, toast]);

  // Load on mount
  useState(() => { load(); });

  function resetForm() {
    setMText(''); setMA(''); setMB(''); setMC(''); setMD(''); setMMarks(1); setMCorrect('');
    setEditingId(null);
    setShowAdd(false);
    setPastedText('');
    setParsedPreview(null);
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mText.trim() || !mA.trim() || !mB.trim() || !mC.trim() || !mD.trim()) {
      toast.show('Please fill in the question text and all four options.', 'error');
      return;
    }
    if (editingId) {
      const { error } = await updateQuestion(editingId, {
        text: mText, optionA: mA, optionB: mB, optionC: mC, optionD: mD, marks: mMarks,
        correctOption: (mCorrect || null) as 'A' | 'B' | 'C' | 'D' | null,
      });
      if (error) { toast.show(error, 'error'); return; }
      toast.show('Question updated.', 'success');
    } else {
      const { error } = await addQuestion(quizId, {
        text: mText, optionA: mA, optionB: mB, optionC: mC, optionD: mD, marks: mMarks,
        correctOption: (mCorrect || null) as 'A' | 'B' | 'C' | 'D' | null,
      });
      if (error) { toast.show(error, 'error'); return; }
      toast.show('Question added.', 'success');
    }
    resetForm();
    load();
    onQuestionsChanged();
  }

  async function handleFileUpload(file: File) {
    setParsing(true);
    try {
      const parsed = await parseQuestionFile(file);
      if (parsed.length === 0) {
        toast.show('No questions found in the file. Check the format and try again.', 'error');
        setParsing(false);
        return;
      }
      setParsedPreview(parsed);
      toast.show(`${parsed.length} questions parsed from file. Review and import.`, 'info');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to parse file.', 'error');
    }
    setParsing(false);
  }

  async function handleParseText() {
    if (!pastedText.trim()) {
      toast.show('Please paste some question text first.', 'error');
      return;
    }
    setParsing(true);
    const parsed = parseQuestionsText(pastedText);
    setParsing(false);
    if (parsed.length === 0) {
      toast.show('No questions found. Check the format and try again.', 'error');
      return;
    }
    setParsedPreview(parsed);
    toast.show(`${parsed.length} questions detected. Review and import.`, 'info');
  }

  async function handleImportPreview() {
    if (!parsedPreview || parsedPreview.length === 0) return;
    setParsing(true);
    const { imported, error } = await bulkAddQuestions(quizId, parsedPreview.map((q) => ({
      text: q.text, optionA: q.optionA, optionB: q.optionB, optionC: q.optionC, optionD: q.optionD, marks: q.marks,
      correctOption: q.correctOption,
    })));
    setParsing(false);
    if (error) { toast.show(error, 'error'); return; }
    toast.show(`${imported} of ${parsedPreview.length} questions imported.`, 'success');
    setParsedPreview(null);
    setPastedText('');
    resetForm();
    load();
    onQuestionsChanged();
  }

  async function handleDelete(id: string) {
    const { error } = await deleteQuestion(id);
    if (error) { toast.show(error, 'error'); return; }
    toast.show('Question deleted.', 'success');
    load();
    onQuestionsChanged();
  }

  function startEdit(q: Question) {
    setEditingId(q.id);
    setMText(q.text);
    setMA(q.optionA);
    setMB(q.optionB);
    setMC(q.optionC);
    setMD(q.optionD);
    setMMarks(q.marks);
    setMCorrect(q.correctOption || '');
    setInputMode('manual');
    setShowAdd(true);
  }

  function handleDragStart(index: number) {
    dragItem.current = index;
  }
  function handleDragEnter(index: number) {
    dragOverItem.current = index;
  }
  async function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const from = dragItem.current;
    const to = dragOverItem.current;
    const reordered = [...questions];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setQuestions(reordered);
    dragItem.current = null;
    dragOverItem.current = null;
    const { error } = await reorderQuestions(quizId, reordered.map((q) => q.id));
    if (error) toast.show('Failed to save order: ' + error, 'error');
    else toast.show('Question order saved.', 'success');
  }

  function moveQuestion(index: number, dir: 'up' | 'down') {
    const to = dir === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[to]] = [reordered[to], reordered[index]];
    setQuestions(reordered);
    reorderQuestions(quizId, reordered.map((q) => q.id)).then(({ error }) => {
      if (error) toast.show('Failed to save order.', 'error');
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-700 text-ink-900">Questions</h3>
          <p className="text-sm text-ink-500">
            {questions.length} of {expectedCount} questions added
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-600 text-white transition hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" /> Add Question
        </button>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-primary-500 transition-all"
          style={{ width: `${Math.min(100, (questions.length / Math.max(1, expectedCount)) * 100)}%` }}
        />
      </div>

      {/* Add / Edit panel */}
      {showAdd && (
        <div className="mt-5 rounded-2xl border border-ink-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
          <div className="flex items-center justify-between">
            <h4 className="font-600 text-ink-900">{editingId ? 'Edit Question' : 'Add Question'}</h4>
            <button onClick={resetForm} className="text-ink-400 hover:text-ink-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Input mode tabs */}
          {!editingId && (
            <div className="mt-4 flex gap-1 rounded-lg border border-ink-200 bg-ink-50 p-1">
              {([
                { key: 'manual', label: 'Manual', icon: Plus },
                { key: 'file', label: 'Upload File', icon: FileUp },
                { key: 'text', label: 'Paste Text', icon: Link2 },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setInputMode(tab.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-600 transition ${
                    inputMode === tab.key ? 'bg-white text-primary-700 shadow-sm' : 'text-ink-500 hover:text-ink-900'
                  }`}
                >
                  <tab.icon className="h-4 w-4" /> {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Manual form */}
          {inputMode === 'manual' && (
            <form onSubmit={handleManualSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-500 text-ink-700">Question Text</label>
                <textarea
                  value={mText}
                  onChange={(e) => setMText(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  placeholder="What is the time complexity of binary search?"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Option A', val: mA, set: setMA },
                  { label: 'Option B', val: mB, set: setMB },
                  { label: 'Option C', val: mC, set: setMC },
                  { label: 'Option D', val: mD, set: setMD },
                ].map((o) => (
                  <div key={o.label}>
                    <label className="text-sm font-500 text-ink-700">{o.label}</label>
                    <input
                      value={o.val}
                      onChange={(e) => o.set(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                      placeholder="Option text"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-6">
                <div>
                  <label className="text-sm font-500 text-ink-700">Marks</label>
                  <input
                    type="number"
                    min={0}
                    value={mMarks}
                    onChange={(e) => setMMarks(parseInt(e.target.value) || 1)}
                    className="mt-1 w-32 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  />
                </div>
                <div>
                  <label className="text-sm font-500 text-ink-700">Correct Answer (for auto-evaluation)</label>
                  <div className="mt-1 flex gap-2">
                    {(['A', 'B', 'C', 'D'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setMCorrect(mCorrect === opt ? '' : opt)}
                        className={`h-9 w-9 rounded-lg border text-sm font-700 transition ${
                          mCorrect === opt
                            ? 'border-success-500 bg-success-500 text-white'
                            : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="submit"
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-600 text-white hover:bg-primary-700"
              >
                {editingId ? 'Update' : 'Add'} Question
              </button>
            </form>
          )}

          {/* File upload */}
          {inputMode === 'file' && !editingId && (
            <div className="mt-4">
              <div
                onClick={() => fileRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 px-6 py-10 text-center transition hover:border-primary-300 hover:bg-primary-50"
              >
                {parsing ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
                ) : (
                  <Upload className="h-8 w-8 text-ink-400" />
                )}
                <p className="mt-3 text-sm font-500 text-ink-700">
                  Click to upload a .txt, .docx, or .pdf file
                </p>
                <p className="mt-1 text-xs text-ink-400">
                  Upload a PDF, Word, or text file. Questions are extracted automatically.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.docx,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                  }}
                />
              </div>
            </div>
          )}

          {/* Paste text */}
          {inputMode === 'text' && !editingId && (
            <div className="mt-4">
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                placeholder={`1. What is 2+2?\nA) 3\nB) 4\nC) 5\nD) 6\nAns: B\nMarks: 1\n\n2. Capital of France?\nA) London\nB) Paris\nC) Berlin\nD) Rome\nAns: B\nMarks: 2`}
              />
              <button
                onClick={handleParseText}
                disabled={parsing}
                className="mt-3 flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-600 text-ink-700 hover:bg-ink-50"
              >
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Parse Text
              </button>
            </div>
          )}

          {/* Parsed preview */}
          {parsedPreview && (
            <div className="mt-4 rounded-xl border border-primary-200 bg-primary-50/50 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-600 text-primary-700">
                  <CheckCircle2 className="h-4 w-4" /> {parsedPreview.length} questions detected
                </span>
                <button onClick={() => setParsedPreview(null)} className="text-ink-400 hover:text-ink-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {parsedPreview.map((q, i) => (
                  <div key={i} className="rounded-lg border border-ink-200 bg-white p-3 text-sm">
                    <p className="font-600 text-ink-900">{i + 1}. {q.text}</p>
                    <p className="mt-1 text-xs text-ink-500">
                      A) {q.optionA} | B) {q.optionB} | C) {q.optionC} | D) {q.optionD} — {q.marks} marks
                      {q.correctOption && <span className="ml-2 font-700 text-success-500">Correct: {q.correctOption}</span>}
                    </p>
                  </div>
                ))}
              </div>
              <button
                onClick={handleImportPreview}
                disabled={parsing}
                className="mt-3 flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-600 text-white hover:bg-primary-700"
              >
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Import {parsedPreview.length} Questions
              </button>
            </div>
          )}
        </div>
      )}

      {/* Question list */}
      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-white py-12 text-center">
            <AlertCircle className="h-8 w-8 text-ink-300" />
            <p className="mt-2 text-sm font-500 text-ink-500">No questions yet</p>
            <p className="text-xs text-ink-400">Add questions manually, upload a file, or paste text.</p>
          </div>
        ) : (
          questions.map((q, i) => (
            <div
              key={q.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragEnter={() => handleDragEnter(i)}
              onDragEnd={handleDragEnd}
              className="group flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,20,28,0.04)]"
            >
              <div className="flex flex-col items-center gap-1 pt-1">
                <GripVertical className="h-4 w-4 cursor-grab text-ink-300" />
                <button onClick={() => moveQuestion(i, 'up')} disabled={i === 0} className="text-ink-300 hover:text-ink-600 disabled:opacity-30">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => moveQuestion(i, 'down')} disabled={i === questions.length - 1} className="text-ink-300 hover:text-ink-600 disabled:opacity-30">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-50 text-xs font-700 text-primary-700">{i + 1}</span>
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-600 text-ink-600">{q.marks} marks</span>
                </div>
                <p className="mt-2 text-sm font-600 text-ink-900">{q.text}</p>
                <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-ink-500 sm:grid-cols-2">
                  <span className={q.correctOption === 'A' ? 'font-700 text-success-500' : ''}>A) {q.optionA}</span>
                  <span className={q.correctOption === 'B' ? 'font-700 text-success-500' : ''}>B) {q.optionB}</span>
                  <span className={q.correctOption === 'C' ? 'font-700 text-success-500' : ''}>C) {q.optionC}</span>
                  <span className={q.correctOption === 'D' ? 'font-700 text-success-500' : ''}>D) {q.optionD}</span>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(q)} className="rounded-lg p-2 text-ink-400 hover:bg-ink-50 hover:text-primary-600">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(q.id)} className="rounded-lg p-2 text-ink-400 hover:bg-danger-500/5 hover:text-danger-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

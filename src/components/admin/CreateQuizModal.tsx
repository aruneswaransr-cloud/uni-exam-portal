import { useState, type FormEvent } from 'react';
import { Loader2, X, Calendar, Clock, Users, ListChecks, FileText, Plus, Trash2, GripVertical } from 'lucide-react';
import { createQuiz, type QuizInput, type ParticipantField } from '@/services/adminApi';
import { useToast } from '@/components/Toast';

interface CreateQuizModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const DEFAULT_FIELDS: ParticipantField[] = [
  { id: 'full_name', label: 'Full Name', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'full_name' },
  { id: 'email', label: 'Email', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'email' },
  { id: 'phone', label: 'Phone Number', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'phone' },
  { id: 'register_number', label: 'Register Number', type: 'text', required: true, choices: [], isDefault: true, defaultKey: 'register_number' },
  { id: 'department', label: 'Department', type: 'select', required: true, choices: ['Computer Science', 'Information Technology', 'Electronics & Communication', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering', 'Chemical Engineering', 'Biotechnology', 'Aerospace Engineering', 'Other'], isDefault: true, defaultKey: 'department' },
];

function genId() {
  return 'f_' + Math.random().toString(36).slice(2, 9);
}

export function CreateQuizModal({ open, onClose, onCreated }: CreateQuizModalProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<QuizInput>({
    title: '',
    description: '',
    quizDate: '',
    startTime: '09:00',
    endTime: '10:00',
    durationMinutes: 30,
    maxParticipants: 50,
    numQuestions: 10,
    participantFields: DEFAULT_FIELDS.map((f) => ({ ...f })),
  });

  function update<K extends keyof QuizInput>(key: K, value: QuizInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateField(idx: number, patch: Partial<ParticipantField>) {
    setForm((f) => {
      const fields = [...f.participantFields];
      fields[idx] = { ...fields[idx], ...patch };
      return { ...f, participantFields: fields };
    });
  }

  function addField() {
    setForm((f) => ({
      ...f,
      participantFields: [
        ...f.participantFields,
        { id: genId(), label: '', type: 'text', required: false, choices: [] },
      ],
    }));
  }

  function removeField(idx: number) {
    setForm((f) => {
      const fields = [...f.participantFields];
      fields.splice(idx, 1);
      return { ...f, participantFields: fields };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.show('Please enter a quiz title.', 'error');
      return;
    }
    const customFields = form.participantFields.filter((f) => !f.isDefault);
    for (const f of customFields) {
      if (!f.label.trim()) {
        toast.show('All custom fields must have a label.', 'error');
        return;
      }
      if (f.type === 'select' && f.choices.filter((c) => c.trim()).length < 2) {
        toast.show(`Field "${f.label}" needs at least 2 choices.`, 'error');
        return;
      }
    }
    setLoading(true);
    const { error } = await createQuiz(form);
    setLoading(false);
    if (error) {
      toast.show(error, 'error');
      return;
    }
    toast.show('Quiz created successfully! A unique code has been generated.', 'success');
    setForm({
      title: '', description: '', quizDate: '', startTime: '09:00', endTime: '10:00',
      durationMinutes: 30, maxParticipants: 50, numQuestions: 10,
      participantFields: DEFAULT_FIELDS.map((f) => ({ ...f })),
    });
    onCreated();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-ink-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-700 text-ink-900">Create New Quiz</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-500 text-ink-700">
              <FileText className="h-4 w-4 text-ink-400" /> Quiz Title
            </label>
            <input
              required
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="e.g. Data Structures Quiz"
            />
          </div>

          <div>
            <label className="text-sm font-500 text-ink-700">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="Brief description of the quiz"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-500 text-ink-700">
              <Calendar className="h-4 w-4 text-ink-400" /> Quiz Date
            </label>
            <input
              type="date"
              required
              value={form.quizDate}
              onChange={(e) => update('quizDate', e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-500 text-ink-700">
                <Clock className="h-4 w-4 text-ink-400" /> Start Time
              </label>
              <input
                type="time"
                required
                value={form.startTime}
                onChange={(e) => update('startTime', e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-500 text-ink-700">
                <Clock className="h-4 w-4 text-ink-400" /> End Time
              </label>
              <input
                type="time"
                required
                value={form.endTime}
                onChange={(e) => update('endTime', e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-500 text-ink-700">
                <Clock className="h-4 w-4 text-ink-400" /> Duration (min)
              </label>
              <input
                type="number"
                min={1}
                required
                value={form.durationMinutes}
                onChange={(e) => update('durationMinutes', parseInt(e.target.value) || 30)}
                className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-500 text-ink-700">
                <Users className="h-4 w-4 text-ink-400" /> Max Participants
              </label>
              <input
                type="number"
                min={1}
                max={500}
                required
                value={form.maxParticipants}
                onChange={(e) => update('maxParticipants', Math.min(500, parseInt(e.target.value) || 50))}
                className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
              <p className="mt-1 text-xs text-ink-400">Up to 500 participants</p>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-500 text-ink-700">
                <ListChecks className="h-4 w-4 text-ink-400" /> Num Questions
              </label>
              <input
                type="number"
                min={1}
                required
                value={form.numQuestions}
                onChange={(e) => update('numQuestions', parseInt(e.target.value) || 10)}
                className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </div>
          </div>

          {/* Participant Details Configuration */}
          <div className="rounded-xl border border-ink-200 bg-ink-50/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-600 text-ink-800">Participant Details to Collect</p>
                <p className="text-xs text-ink-500">Choose which fields participants must fill in when joining.</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {form.participantFields.map((field, idx) => (
                <div key={field.id} className="rounded-lg border border-ink-200 bg-white p-3">
                  <div className="flex items-start gap-2">
                    <div className="mt-1.5 text-ink-300">
                      {field.isDefault ? <GripVertical className="h-4 w-4 opacity-40" /> : <GripVertical className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(idx, { label: e.target.value })}
                          disabled={field.isDefault}
                          className="flex-1 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-100 disabled:bg-ink-50 disabled:text-ink-500"
                          placeholder="Field label (e.g. Roll Number)"
                        />
                        <select
                          value={field.type}
                          onChange={(e) => updateField(idx, { type: e.target.value as 'text' | 'select' })}
                          disabled={field.isDefault && field.defaultKey === 'department' ? false : field.isDefault}
                          className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 disabled:bg-ink-50 disabled:text-ink-500"
                        >
                          <option value="text">Text</option>
                          <option value="select">Dropdown</option>
                        </select>
                        {!field.isDefault && (
                          <button
                            type="button"
                            onClick={() => removeField(idx)}
                            className="rounded-md p-1.5 text-danger-500 transition hover:bg-danger-500/5"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {field.type === 'select' && (
                        <input
                          type="text"
                          value={field.choices.join(', ')}
                          onChange={(e) => updateField(idx, { choices: e.target.value.split(',').map((c) => c.trim()).filter(Boolean) })}
                          className="w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-100"
                          placeholder="Choices separated by commas (e.g. A, B, C)"
                        />
                      )}

                      <label className="flex items-center gap-2 text-xs text-ink-600">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(idx, { required: e.target.checked })}
                          className="rounded border-ink-300 text-primary-600 focus:ring-primary-500"
                        />
                        Required
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addField}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 bg-white py-2 text-sm font-600 text-ink-600 transition hover:border-primary-400 hover:text-primary-600"
            >
              <Plus className="h-4 w-4" /> Add Custom Field
            </button>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-600 text-ink-700 transition hover:bg-ink-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-600 text-white transition hover:bg-primary-700 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Quiz
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

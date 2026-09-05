import { useState, type FormEvent } from 'react';
import { Loader2, X, Plus, Trash2, GripVertical, ListChecks } from 'lucide-react';
import { updateQuizFields, type ParticipantField } from '@/services/adminApi';
import { useToast } from '@/components/Toast';

interface EditFieldsModalProps {
  quizId: string;
  quizTitle: string;
  fields: ParticipantField[];
  onClose: () => void;
  onSaved: () => void;
}

function genId() {
  return 'f_' + Math.random().toString(36).slice(2, 9);
}

export function EditFieldsModal({ quizId, quizTitle, fields, onClose, onSaved }: EditFieldsModalProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [participantFields, setParticipantFields] = useState<ParticipantField[]>(fields.map((f) => ({ ...f })));

  function updateField(idx: number, patch: Partial<ParticipantField>) {
    setParticipantFields((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }

  function addField() {
    setParticipantFields((prev) => [
      ...prev,
      { id: genId(), label: '', type: 'text', required: false, choices: [] },
    ]);
  }

  function removeField(idx: number) {
    setParticipantFields((prev) => {
      const copy = [...prev];
      copy.splice(idx, 1);
      return copy;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const customFields = participantFields.filter((f) => !f.isDefault);
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
    const { error } = await updateQuizFields(quizId, participantFields);
    setLoading(false);
    if (error) {
      toast.show(error, 'error');
      return;
    }
    toast.show('Participant fields updated.', 'success');
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-ink-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-700 text-ink-900">Edit Participant Fields</h2>
            <p className="mt-0.5 text-sm text-ink-500">{quizTitle}</p>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-700">
          <ListChecks className="h-3.5 w-3.5" />
          Changes apply to new participant registrations. Existing participants keep their submitted data.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="space-y-2">
            {participantFields.map((field, idx) => (
              <div key={field.id} className="rounded-lg border border-ink-200 bg-white p-3">
                <div className="flex items-start gap-2">
                  <div className="mt-1.5 text-ink-300">
                    <GripVertical className="h-4 w-4" />
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
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 bg-white py-2 text-sm font-600 text-ink-600 transition hover:border-primary-400 hover:text-primary-600"
          >
            <Plus className="h-4 w-4" /> Add Custom Field
          </button>

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
              Save Fields
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

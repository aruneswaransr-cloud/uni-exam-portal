import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export interface ParsedQuestion {
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  marks: number;
  correctOption: 'A' | 'B' | 'C' | 'D' | null;
}

const OPTION_RE = /^\s*[(]?([A-Da-d])[).:\s]\s*(.+)$/;
const MARKS_RE = /^\s*marks\s*[:=]\s*(\d+(?:\.\d+)?)/i;
const Q_PREFIX_RE = /^\s*(?:Q|Question)\s*[:.)\s]\s*(.+)$/i;
const NUMBERED_RE = /^\s*(\d+)\s*[.)\s]\s+(.+)$/;
const ANS_RE = /^\s*(?:Ans|Answer|Correct)\s*[:=]\s*[(]?([A-Da-d])[)]?/i;

function normalizeOption(letter: string): string {
  return letter.toUpperCase();
}

function hasAllOptions(opts: Record<string, string>): boolean {
  return !!(opts.A && opts.B && opts.C && opts.D);
}

export function parseQuestionsText(raw: string): ParsedQuestion[] {
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/((?:Ans(?:wer)?|Correct)\s*[:=])\s*([A-Da-d])\b/gi, '$1 $2')
    .replace(/(?:^|\s)(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.)]\s+/gi, '\n$1. ')
    .replace(/\s+(?=[A-Da-d]\s*[).:]\s+)/g, '\n')
    .replace(/\s+(?=(?:Ans(?:wer)?|Correct)\s*[:=])/gi, '\n')
    .replace(/\s+(?=Marks\s*[:=])/gi, '\n');
  const lines = text.split('\n').map((l) => l.trim());

  const questions: ParsedQuestion[] = [];
  let current: {
    text: string;
    options: Record<string, string>;
    marks: number | undefined;
    correct: 'A' | 'B' | 'C' | 'D' | null;
    currentOption: string | null;
  } = { text: '', options: {}, marks: undefined, correct: null, currentOption: null };

  function flush() {
    if (current.text && hasAllOptions(current.options)) {
      questions.push({
        text: current.text.trim(),
        optionA: current.options.A.trim(),
        optionB: current.options.B.trim(),
        optionC: current.options.C.trim(),
        optionD: current.options.D.trim(),
        marks: current.marks ?? 1,
        correctOption: current.correct,
      });
    }
    current = { text: '', options: {}, marks: undefined, correct: null, currentOption: null };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      if (current.text) flush();
      continue;
    }

    const ansMatch = line.match(ANS_RE);
    if (ansMatch) {
      current.correct = normalizeOption(ansMatch[1]) as 'A' | 'B' | 'C' | 'D';
      continue;
    }

    const marksMatch = line.match(MARKS_RE);
    if (marksMatch) {
      current.marks = parseFloat(marksMatch[1]);
      continue;
    }

    const optMatch = line.match(OPTION_RE);
    if (optMatch) {
      const letter = normalizeOption(optMatch[1]);
      current.options[letter] = optMatch[2];
      current.currentOption = letter;
      continue;
    }

    const qPrefixMatch = line.match(Q_PREFIX_RE);
    if (qPrefixMatch) {
      if (current.text) flush();
      current.text = qPrefixMatch[1];
      continue;
    }

    const numberedMatch = line.match(NUMBERED_RE);
    if (numberedMatch) {
      if (current.text) flush();
      current.text = numberedMatch[2];
      continue;
    }

    if (!current.text && !optMatch) {
      current.text = line;
      continue;
    }

    if (current.text && current.currentOption) {
      current.options[current.currentOption] += ' ' + line;
    } else if (current.text) {
      current.text += ' ' + line;
    }
  }

  flush();
  return questions;
}

export async function parseTxtFile(file: File): Promise<ParsedQuestion[]> {
  const text = await file.text();
  return parseQuestionsText(text);
}

export async function parseDocxFile(file: File): Promise<ParsedQuestion[]> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return parseQuestionsText(result.value);
}

export async function parsePdfFile(file: File): Promise<ParsedQuestion[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    fullText += reconstructPdfLines(content.items) + '\n';
  }
  return parseQuestionsText(fullText);
}

function reconstructPdfLines(items: unknown[]): string {
  type TextItem = { str: string; transform?: number[] };
  type PositionedItem = { text: string; x: number; y: number };
  const positioned = (items as TextItem[])
    .filter((item) => item.str?.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }));
  const rows: PositionedItem[][] = [];

  for (const item of positioned) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) < 3);
    if (row) row.push(item);
    else rows.push([item]);
  }

  return rows
    .sort((a, b) => b[0].y - a[0].y)
    .map((row) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
    .join('\n');
}

export async function parseQuestionFile(file: File): Promise<ParsedQuestion[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt')) return parseTxtFile(file);
  if (name.endsWith('.docx')) return parseDocxFile(file);
  if (name.endsWith('.pdf')) return parsePdfFile(file);
  if (name.endsWith('.doc')) throw new Error('Legacy .doc format is not supported. Please save as .docx.');
  throw new Error('Unsupported file format. Please upload a .txt, .docx, or .pdf file.');
}

export function exportResultsToExcel(results: Array<Record<string, unknown>>, quizTitle: string) {
  const rows = results.map((r, i) => ({
    Rank: i + 1,
    Name: r.full_name,
    Email: r.email,
    Phone: r.phone,
    'Register Number': r.register_number,
    'Quiz Name': r.quiz_title,
    'Total Marks': r.total_marks,
    'Marks Obtained': r.marks_obtained,
    Percentage: r.percentage,
    Grade: r.grade || '',
    'Submission Time': r.submitted_at ? new Date(r.submitted_at as string).toLocaleString() : '',
    'End Reason': r.end_reason || '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Results');
  XLSX.writeFile(wb, `${quizTitle.replace(/[^a-zA-Z0-9]/g, '_')}_results.xlsx`);
}

export interface ReportRow {
  rank: number;
  full_name: string;
  department: string;
  marks_obtained: number;
  total_marks: number;
  percentage: number;
  answered_count: number;
  total_questions: number;
  submitted_at: string | null;
  time_taken_seconds: number | null;
}

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9]/g, '_');
}

function formatTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

export function exportReportToExcel(rows: ReportRow[], quizTitle: string, reportType: 'alphabetical' | 'ranked') {
  const sheetRows = rows.map((r) => ({
    Rank: r.rank,
    Name: r.full_name,
    Department: r.department || 'Not specified',
    'Questions Answered': `${r.answered_count} / ${r.total_questions}`,
    'Marks Obtained': r.marks_obtained,
    'Total Marks': r.total_marks,
    Percentage: r.percentage,
    'Submission Time': formatDate(r.submitted_at),
    'Time Taken': formatTime(r.time_taken_seconds),
  }));
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  const sheetName = reportType === 'alphabetical' ? 'Alphabetical' : 'AI Ranked';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${sanitizeFilename(quizTitle)}_${reportType}_report.xlsx`);
}

export function exportReportToWord(rows: ReportRow[], quizTitle: string, reportType: 'alphabetical' | 'ranked') {
  const reportTitle = reportType === 'alphabetical'
    ? 'Participant Report (Alphabetical Order)'
    : 'AI-Analyzed Ranked Report (By Score)';

  const tableRows = rows.map((r) => `
    <tr>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.rank}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${r.full_name}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${r.department || 'Not specified'}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.answered_count} / ${r.total_questions}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.marks_obtained} / ${r.total_marks}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.percentage}%</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${formatDate(r.submitted_at)}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${formatTime(r.time_taken_seconds)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${reportTitle}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 12px; color: #1a1a2e; }
  h1 { font-size: 20px; color: #2546eb; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: normal; color: #666; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th { background: #2546eb; color: white; padding: 8px 10px; border: 1px solid #ddd; font-size: 11px; text-transform: uppercase; }
  tr:nth-child(even) { background: #f8f9fa; }
  .summary { margin-top: 12px; padding: 10px; background: #f0f4ff; border-radius: 4px; }
</style></head>
<body>
  <h1>${quizTitle}</h1>
  <h2>${reportTitle}</h2>
  <div class="summary"><strong>Total Participants:</strong> ${rows.length}</div>
  <table>
    <thead><tr>
      <th style="text-align:center">Rank</th>
      <th>Name</th>
      <th>Department</th>
      <th>Answered</th>
      <th>Score</th>
      <th>Percentage</th>
      <th>Submitted At</th>
      <th>Time Taken</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body></html>`;

  const blob = new Blob([html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(quizTitle)}_${reportType}_report.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportReportToPDF(rows: ReportRow[], quizTitle: string, reportType: 'alphabetical' | 'ranked') {
  const reportTitle = reportType === 'alphabetical'
    ? 'Participant Report (Alphabetical Order)'
    : 'AI-Analyzed Ranked Report (By Score)';

  const tableRows = rows.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8f9fa' : 'white'}">
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.rank}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${r.full_name}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${r.department || 'Not specified'}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.answered_count} / ${r.total_questions}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.marks_obtained} / ${r.total_marks}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${r.percentage}%</td>
      <td style="padding:6px 10px;border:1px solid #ddd;font-size:10px">${formatDate(r.submitted_at)}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${formatTime(r.time_taken_seconds)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${reportTitle}</title>
<style>
  @media print { @page { margin: 1.5cm; } }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1a1a2e; }
  h1 { font-size: 20px; color: #2546eb; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: normal; color: #666; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th { background: #2546eb; color: white; padding: 8px 10px; border: 1px solid #ddd; font-size: 10px; text-transform: uppercase; }
  .summary { margin-top: 12px; padding: 10px; background: #f0f4ff; border-radius: 4px; }
  .footer { margin-top: 20px; font-size: 10px; color: #999; text-align: center; }
</style></head><body>
  <h1>${quizTitle}</h1>
  <h2>${reportTitle}</h2>
  <div class="summary"><strong>Total Participants:</strong> ${rows.length}</div>
  <table>
    <thead><tr>
      <th style="text-align:center">Rank</th>
      <th>Name</th>
      <th>Department</th>
      <th>Answered</th>
      <th>Score</th>
      <th>Percentage</th>
      <th>Submitted At</th>
      <th>Time Taken</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">Generated on ${new Date().toLocaleString()}</div>
  <script>window.onload = function() { window.print(); }</script>
</body></html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

export interface AnswerKeyEntry {
  position?: number;
  question_id?: string;
  correct_option: 'A' | 'B' | 'C' | 'D';
}

function normalizeAnswerLetter(letter: string): string {
  return letter.toUpperCase().trim();
}

export function parseAnswerKeyText(raw: string): AnswerKeyEntry[] {
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ');
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);

  const entries: AnswerKeyEntry[] = [];

  for (const line of lines) {
    const m = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)\s*[.)\s:=-]*\s*(?:Ans(?:wer)?\s*[:=]?\s*|Correct\s*[:=]?\s*)?[(]?([A-Da-d])[)]?/i);
    if (m) {
      const position = parseInt(m[1], 10);
      const correct = normalizeAnswerLetter(m[2]) as 'A' | 'B' | 'C' | 'D';
      if (position >= 1 && correct) {
        entries.push({ position, correct_option: correct });
      }
      continue;
    }

    const m2 = line.match(/^(?:Ans(?:wer)?|Correct)\s*[:=]\s*[(]?([A-Da-d])[)]?/i);
    if (m2) {
      const correct = normalizeAnswerLetter(m2[1]) as 'A' | 'B' | 'C' | 'D';
      entries.push({ position: entries.length + 1, correct_option: correct });
      continue;
    }

    const m3 = line.match(/^[(]?([A-Da-d])[)]?\s*$/i);
    if (m3) {
      const correct = normalizeAnswerLetter(m3[1]) as 'A' | 'B' | 'C' | 'D';
      entries.push({ position: entries.length + 1, correct_option: correct });
    }
  }

  return entries;
}

export async function parseAnswerKeyFile(file: File): Promise<AnswerKeyEntry[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt')) {
    return parseAnswerKeyText(await file.text());
  }
  if (name.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return parseAnswerKeyText(result.value);
  }
  if (name.endsWith('.pdf')) {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url,
    ).toString();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      fullText += reconstructPdfLines(content.items) + '\n';
    }
    return parseAnswerKeyText(fullText);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    const entries: AnswerKeyEntry[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const pos = row['Question'] ?? row['Q'] ?? row['Q.No'] ?? row['No'] ?? row['Number'] ?? (i + 1);
      const ans = row['Answer'] ?? row['Correct'] ?? row['Correct Option'] ?? row['Ans'] ?? row['Key'];
      if (ans) {
        const correct = normalizeAnswerLetter(String(ans)) as 'A' | 'B' | 'C' | 'D';
        if (correct) entries.push({ position: parseInt(String(pos), 10) || (i + 1), correct_option: correct });
      }
    }
    return entries;
  }
  if (name.endsWith('.csv')) {
    return parseAnswerKeyText(await file.text());
  }
  if (name.endsWith('.doc')) throw new Error('Legacy .doc format is not supported. Please save as .docx.');
  throw new Error('Unsupported file format. Please upload a .txt, .docx, .pdf, .xlsx, or .csv file.');
}

export function generateQuizCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `QUIZ-${suffix}`;
}

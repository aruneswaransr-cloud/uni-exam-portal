import type { ParticipantField } from '@/services/adminApi';

export type QuizStatus = 'DRAFT' | 'WAITING' | 'LIVE' | 'STOPPED' | 'COMPLETED';

export type { ParticipantField };

export interface Quiz {
  id: string;
  code: string | null;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  maxParticipants: number;
  numQuestions: number;
  status: QuizStatus;
  evaluationMode: 'manual' | 'auto';
  deviceMode: 'laptop' | 'mobile' | 'both';
  participantFields: ParticipantField[];
  createdAt: string;
}

export interface Question {
  id: string;
  quizId: string;
  order: number;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  marks: number;
  correctOption: 'A' | 'B' | 'C' | 'D' | null;
}

export interface Participant {
  id: string;
  quizId: string;
  fullName: string;
  email: string;
  phone: string;
  registerNumber: string;
  approved: boolean;
  rejected: boolean;
  joinedAt: string;
}

export interface Attempt {
  id: string;
  quizId: string;
  participantId: string;
  questionOrder: string[];
  startedAt: string | null;
  submittedAt: string | null;
}

export interface Response {
  id: string;
  attemptId: string;
  questionId: string;
  selectedOption: 'A' | 'B' | 'C' | 'D' | null;
  savedAt: string;
}

export interface Evaluation {
  id: string;
  responseId: string;
  marksAwarded: number;
  evaluatedAt: string;
}

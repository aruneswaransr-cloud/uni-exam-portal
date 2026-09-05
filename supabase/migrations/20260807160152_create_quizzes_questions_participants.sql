/*
# Create quizzes, questions, participants tables + participant registration function

1. New Tables
- `quizzes`
  - id (uuid pk)
  - code (text, unique) — human-readable quiz code e.g. QUIZ-7K29P
  - title, description (text)
  - quiz_date (date) — scheduled date
  - start_time, end_time (time) — scheduled window
  - duration_minutes (int) — per-participant duration
  - max_participants (int)
  - num_questions (int)
  - status (text, default 'DRAFT') — DRAFT/WAITING/LIVE/STOPPED/COMPLETED
  - created_by (uuid, references auth.users) — admin who created it
  - created_at (timestamptz)

- `questions`
  - id (uuid pk)
  - quiz_id (uuid fk -> quizzes.id on delete cascade)
  - position (int) — admin-defined order
  - text (text)
  - option_a, option_b, option_c, option_d (text)
  - marks (int, default 1)
  - created_at (timestamptz)

- `participants`
  - id (uuid pk)
  - quiz_id (uuid fk -> quizzes.id on delete cascade)
  - full_name (text)
  - email (text)
  - phone (text)
  - register_number (text)
  - approved (bool, default false)
  - rejected (bool, default false)
  - joined_at (timestamptz, default now())
  - Unique constraint on (quiz_id, register_number) — prevents duplicate register number per quiz
  - Unique constraint on (quiz_id, email) — prevents duplicate email per quiz

2. Security
- quizzes: admin-only access. SELECT/INSERT/UPDATE/DELETE scoped to the admin who owns the quiz
  (created_by = auth.uid()) AND who has an admin_profiles row. This prevents participants
  from reading or mutating quiz records.
- questions: admin-only, scoped through the parent quiz's created_by.
- participants: admins can SELECT/UPDATE for participants in their quizzes.
  Participants (anon/authenticated) can INSERT their own registration via the
  `register_participant` SECURITY DEFINER function (which enforces duplicate checks
  server-side), and can SELECT their own row by id. This is the minimum needed for
  the registration + waiting room flow without exposing other participants' data.

3. Functions
- `register_participant(p_quiz_code, p_full_name, p_email, p_phone, p_register_number)`
  - SECURITY DEFINER so it can read quizzes and insert into participants despite RLS.
  - Validates the quiz code exists and status is WAITING (participants can only join
    before the quiz goes live).
  - Enforces unique register_number and email per quiz server-side (returns a clear
    error code instead of relying on the client).
  - Returns the inserted participant row (id, quiz_id, approved, rejected).
- `is_admin()` helper — returns true if the current user has an admin_profiles row.
  Used in RLS policies.

4. Important notes
- No correct-answer column anywhere — manual evaluation only.
- Participant duplicate prevention is enforced in the database (unique constraints)
  AND in the registration function (clear error messages), so the client cannot
  bypass it.
*/

-- Helper: is the current user an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles WHERE id = auth.uid()
  );
$$;

-- ============ quizzes ============
CREATE TABLE IF NOT EXISTS public.quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  quiz_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  duration_minutes int NOT NULL DEFAULT 30,
  max_participants int NOT NULL DEFAULT 50,
  num_questions int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','WAITING','LIVE','STOPPED','COMPLETED')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_quizzes" ON public.quizzes;
CREATE POLICY "admin_select_quizzes"
  ON public.quizzes FOR SELECT TO authenticated
  USING (public.is_admin() AND created_by = auth.uid());

DROP POLICY IF EXISTS "admin_insert_quizzes" ON public.quizzes;
CREATE POLICY "admin_insert_quizzes"
  ON public.quizzes FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND created_by = auth.uid());

DROP POLICY IF EXISTS "admin_update_quizzes" ON public.quizzes;
CREATE POLICY "admin_update_quizzes"
  ON public.quizzes FOR UPDATE TO authenticated
  USING (public.is_admin() AND created_by = auth.uid())
  WITH CHECK (public.is_admin() AND created_by = auth.uid());

DROP POLICY IF EXISTS "admin_delete_quizzes" ON public.quizzes;
CREATE POLICY "admin_delete_quizzes"
  ON public.quizzes FOR DELETE TO authenticated
  USING (public.is_admin() AND created_by = auth.uid());

-- ============ questions ============
CREATE TABLE IF NOT EXISTS public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  text text NOT NULL,
  option_a text NOT NULL,
  option_b text NOT NULL,
  option_c text NOT NULL,
  option_d text NOT NULL,
  marks int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON public.questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_questions_position ON public.questions(quiz_id, position);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_questions" ON public.questions;
CREATE POLICY "admin_select_questions"
  ON public.questions FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = questions.quiz_id AND q.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_insert_questions" ON public.questions;
CREATE POLICY "admin_insert_questions"
  ON public.questions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = questions.quiz_id AND q.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_update_questions" ON public.questions;
CREATE POLICY "admin_update_questions"
  ON public.questions FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = questions.quiz_id AND q.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = questions.quiz_id AND q.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_delete_questions" ON public.questions;
CREATE POLICY "admin_delete_questions"
  ON public.questions FOR DELETE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = questions.quiz_id AND q.created_by = auth.uid()
    )
  );

-- ============ participants ============
CREATE TABLE IF NOT EXISTS public.participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  register_number text NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  rejected boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_participant_register_number
  ON public.participants(quiz_id, register_number);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_participant_email
  ON public.participants(quiz_id, email);

CREATE INDEX IF NOT EXISTS idx_participants_quiz_id ON public.participants(quiz_id);
CREATE INDEX IF NOT EXISTS idx_participants_approved ON public.participants(quiz_id, approved);

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

-- Admins can read participants in their quizzes
DROP POLICY IF EXISTS "admin_select_participants" ON public.participants;
CREATE POLICY "admin_select_participants"
  ON public.participants FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = participants.quiz_id AND q.created_by = auth.uid()
    )
  );

-- Admins can update (approve/reject) participants in their quizzes
DROP POLICY IF EXISTS "admin_update_participants" ON public.participants;
CREATE POLICY "admin_update_participants"
  ON public.participants FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = participants.quiz_id AND q.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = participants.quiz_id AND q.created_by = auth.uid()
    )
  );

-- Admins can delete participants in their quizzes
DROP POLICY IF EXISTS "admin_delete_participants" ON public.participants;
CREATE POLICY "admin_delete_participants"
  ON public.participants FOR DELETE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = participants.quiz_id AND q.created_by = auth.uid()
    )
  );

-- A participant can read their own row (by id) — needed for waiting room status polling.
-- Scoped to anon, authenticated because participants are not signed-in users.
DROP POLICY IF EXISTS "participant_select_self" ON public.participants;
CREATE POLICY "participant_select_self"
  ON public.participants FOR SELECT TO anon, authenticated
  USING (id::text = current_setting('request.headers', true)::jsonb ->> 'x-participant-id');

-- ============ register_participant function ============
-- SECURITY DEFINER: runs with the function owner's privileges so it can read quizzes
-- and insert into participants regardless of the caller's role. All duplicate and
-- status checks happen here, server-side.
CREATE OR REPLACE FUNCTION public.register_participant(
  p_quiz_code text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_register_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_existing record;
  v_participant public.participants%ROWTYPE;
BEGIN
  -- Basic validation
  IF COALESCE(trim(p_full_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Full name is required.');
  END IF;
  IF COALESCE(trim(p_email), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email is required.');
  END IF;
  IF COALESCE(trim(p_register_number), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Register number is required.');
  END IF;

  -- Find the quiz by code
  SELECT * INTO v_quiz FROM public.quizzes WHERE code = upper(trim(p_quiz_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid quiz code. Please check and try again.');
  END IF;

  -- Quiz must be in WAITING status to join
  IF v_quiz.status <> 'WAITING' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE v_quiz.status
        WHEN 'DRAFT' THEN 'This quiz is not open for registration yet.'
        WHEN 'LIVE' THEN 'This quiz has already started. New participants cannot join.'
        WHEN 'STOPPED' THEN 'This quiz is no longer accepting participants.'
        WHEN 'COMPLETED' THEN 'This quiz has been completed.'
        ELSE 'This quiz is not open for registration.'
      END);
  END IF;

  -- Check max participants not exceeded
  SELECT count(*) INTO v_existing FROM public.participants
    WHERE quiz_id = v_quiz.id AND rejected = false;
  IF v_existing >= v_quiz.max_participants THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This quiz has reached its maximum participant limit.');
  END IF;

  -- Duplicate register number
  SELECT id INTO v_existing FROM public.participants
    WHERE quiz_id = v_quiz.id AND register_number = trim(p_register_number) LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'You have already registered for this quiz with this register number.');
  END IF;

  -- Duplicate email
  SELECT id INTO v_existing FROM public.participants
    WHERE quiz_id = v_quiz.id AND lower(email) = lower(trim(p_email)) LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'This email has already been used to register for this quiz.');
  END IF;

  -- Insert
  INSERT INTO public.participants (quiz_id, full_name, email, phone, register_number)
  VALUES (v_quiz.id, trim(p_full_name), lower(trim(p_email)), trim(p_phone), trim(p_register_number))
  RETURNING * INTO v_participant;

  RETURN jsonb_build_object(
    'ok', true,
    'participant', jsonb_build_object(
      'id', v_participant.id,
      'quiz_id', v_participant.quiz_id,
      'full_name', v_participant.full_name,
      'approved', v_participant.approved,
      'rejected', v_participant.rejected
    ),
    'quiz', jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'status', v_quiz.status
    )
  );
END;
$$;

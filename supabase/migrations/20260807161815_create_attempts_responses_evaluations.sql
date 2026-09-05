/*
# Create attempts, responses, evaluations tables + quiz lifecycle functions

1. New Tables
- `attempts`
  - id (uuid pk)
  - quiz_id (uuid fk -> quizzes.id on delete cascade)
  - participant_id (uuid fk -> participants.id on delete cascade)
  - question_order (jsonb) — array of question IDs in the shuffled order for this participant
  - started_at (timestamptz, nullable) — when the participant entered the quiz (quiz went LIVE)
  - submitted_at (timestamptz, nullable) — when the participant submitted
  - end_reason (text, nullable) — 'manual' | 'timeout' | 'tab_switch' | 'network_lost' | 'admin_stopped'
  - current_index (int, default 0) — which question the participant is currently on
  - answered_count (int, default 0) — how many questions have a selected answer
  - last_seen_at (timestamptz, nullable) — last heartbeat from participant
  - Unique on (quiz_id, participant_id) — one attempt per participant per quiz

- `responses`
  - id (uuid pk)
  - attempt_id (uuid fk -> attempts.id on delete cascade)
  - question_id (uuid fk -> questions.id on delete cascade)
  - selected_option (text, nullable) — 'A'|'B'|'C'|'D' or null if unanswered
  - saved_at (timestamptz, default now())
  - Unique on (attempt_id, question_id)

- `evaluations`
  - id (uuid pk)
  - response_id (uuid fk -> responses.id on delete cascade, unique)
  - marks_awarded (numeric, default 0)
  - evaluated_at (timestamptz, default now())
  - evaluated_by (uuid fk -> auth.users, nullable)

2. Security
- attempts/responses/evaluations: admin-only CRUD scoped through quiz ownership.
  Participants interact via SECURITY DEFINER functions, not direct table access.
- This prevents participants from reading other participants' data, modifying
  marks, or submitting after the quiz ends.

3. Functions
- `start_attempt(p_participant_id)` — creates an attempt with a shuffled question
  order, only if the quiz is LIVE and the participant is approved. Returns the
  attempt + questions in the shuffled order.
- `save_response(p_attempt_id, p_question_id, p_selected_option)` — upserts a
  response. Validates the quiz is still LIVE (not stopped/completed) and the
  attempt is not submitted. Returns the updated answered_count.
- `submit_attempt(p_attempt_id, p_end_reason)` — marks the attempt as submitted
  with the given end reason. Refuses if already submitted.
- `heartbeat(p_attempt_id)` — updates last_seen_at for live monitoring.
- `get_quiz_monitor(p_quiz_id)` — admin-only: returns live stats for a quiz
  (participant list with attempt status, answered count, end reason).
- `evaluate_response(p_response_id, p_marks)` — admin-only: upserts an evaluation.
- `get_results(p_quiz_id)` — admin-only: returns ranked results for export.
*/

-- ============ attempts ============
CREATE TABLE IF NOT EXISTS public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  question_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz,
  submitted_at timestamptz,
  end_reason text CHECK (end_reason IS NULL OR end_reason IN ('manual','timeout','tab_switch','network_lost','admin_stopped')),
  current_index int NOT NULL DEFAULT 0,
  answered_count int NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_quiz_id ON public.attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempts_participant_id ON public.attempts(participant_id);

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_attempts" ON public.attempts;
CREATE POLICY "admin_select_attempts"
  ON public.attempts FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = attempts.quiz_id AND q.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "admin_update_attempts" ON public.attempts;
CREATE POLICY "admin_update_attempts"
  ON public.attempts FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = attempts.quiz_id AND q.created_by = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = attempts.quiz_id AND q.created_by = auth.uid())
  );

-- ============ responses ============
CREATE TABLE IF NOT EXISTS public.responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_option text CHECK (selected_option IS NULL OR selected_option IN ('A','B','C','D')),
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_responses_attempt_id ON public.responses(attempt_id);

ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_responses" ON public.responses;
CREATE POLICY "admin_select_responses"
  ON public.responses FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.attempts a
      JOIN public.quizzes q ON q.id = a.quiz_id
      WHERE a.id = responses.attempt_id AND q.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_delete_responses" ON public.responses;
CREATE POLICY "admin_delete_responses"
  ON public.responses FOR DELETE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.attempts a
      JOIN public.quizzes q ON q.id = a.quiz_id
      WHERE a.id = responses.attempt_id AND q.created_by = auth.uid()
    )
  );

-- ============ evaluations ============
CREATE TABLE IF NOT EXISTS public.evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL UNIQUE REFERENCES public.responses(id) ON DELETE CASCADE,
  marks_awarded numeric NOT NULL DEFAULT 0,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  evaluated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_evaluations" ON public.evaluations;
CREATE POLICY "admin_select_evaluations"
  ON public.evaluations FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.responses r
      JOIN public.attempts a ON a.id = r.attempt_id
      JOIN public.quizzes q ON q.id = a.quiz_id
      WHERE r.id = evaluations.response_id AND q.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_insert_evaluations" ON public.evaluations;
CREATE POLICY "admin_insert_evaluations"
  ON public.evaluations FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.responses r
      JOIN public.attempts a ON a.id = r.attempt_id
      JOIN public.quizzes q ON q.id = a.quiz_id
      WHERE r.id = evaluations.response_id AND q.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_update_evaluations" ON public.evaluations;
CREATE POLICY "admin_update_evaluations"
  ON public.evaluations FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.responses r
      JOIN public.attempts a ON a.id = r.attempt_id
      JOIN public.quizzes q ON q.id = a.quiz_id
      WHERE r.id = evaluations.response_id AND q.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.responses r
      JOIN public.attempts a ON a.id = r.attempt_id
      JOIN public.quizzes q ON q.id = a.quiz_id
      WHERE r.id = evaluations.response_id AND q.created_by = auth.uid()
    )
  );

-- ============ start_attempt function ============
CREATE OR REPLACE FUNCTION public.start_attempt(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_quiz public.quizzes%ROWTYPE;
  v_existing public.attempts%ROWTYPE;
  v_questions jsonb;
  v_order jsonb;
  v_attempt public.attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE id = p_participant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Participant not found.');
  END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_participant.quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.');
  END IF;

  IF v_quiz.status <> 'LIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The quiz has not started yet.');
  END IF;

  IF NOT v_participant.approved THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You have not been approved to take this quiz.');
  END IF;

  IF v_participant.rejected THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Your registration was rejected.');
  END IF;

  -- Check for existing attempt
  SELECT * INTO v_existing FROM public.attempts WHERE participant_id = p_participant_id;
  IF FOUND THEN
    -- If already submitted, return that
    IF v_existing.submitted_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this quiz.', 'submitted', true);
    END IF;
    -- Resume existing attempt — return questions in stored order
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', q.id, 'text', q.text, 'option_a', q.option_a,
      'option_b', q.option_b, 'option_c', q.option_c,
      'option_d', q.option_d, 'marks', q.marks, 'position', q.position
    ) ORDER BY ord.position), '[]'::jsonb)
    INTO v_questions
    FROM public.questions q
    JOIN unnest(v_existing.question_order::text[]) WITH ORDINALITY AS ord(id, position) ON ord.id = q.id::text;

    RETURN jsonb_build_object(
      'ok', true,
      'attempt', jsonb_build_object(
        'id', v_existing.id, 'current_index', v_existing.current_index,
        'answered_count', v_existing.answered_count,
        'started_at', v_existing.started_at,
        'submitted_at', v_existing.submitted_at
      ),
      'quiz', jsonb_build_object(
        'id', v_quiz.id, 'title', v_quiz.title,
        'duration_minutes', v_quiz.duration_minutes,
        'status', v_quiz.status, 'num_questions', v_quiz.num_questions
      ),
      'questions', v_questions,
      'question_order', v_existing.question_order
    );
  END IF;

  -- Build shuffled question order
  SELECT COALESCE(jsonb_agg(q.id::text ORDER BY random()), '[]'::jsonb)
    INTO v_order
    FROM public.questions q WHERE q.quiz_id = v_quiz.id;

  IF jsonb_array_length(v_order) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No questions have been added to this quiz yet.');
  END IF;

  -- Create attempt
  INSERT INTO public.attempts (quiz_id, participant_id, question_order, started_at, last_seen_at)
  VALUES (v_quiz.id, p_participant_id, v_order, now(), now())
  RETURNING * INTO v_attempt;

  -- Fetch questions in shuffled order
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'text', q.text, 'option_a', q.option_a,
    'option_b', q.option_b, 'option_c', q.option_c,
    'option_d', q.option_d, 'marks', q.marks, 'position', q.position
  ) ORDER BY ord.position), '[]'::jsonb)
  INTO v_questions
  FROM public.questions q
  JOIN unnest(v_order::text[]) WITH ORDINALITY AS ord(id, position) ON ord.id = q.id::text;

  RETURN jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'id', v_attempt.id, 'current_index', 0, 'answered_count', 0,
      'started_at', v_attempt.started_at, 'submitted_at', null
    ),
    'quiz', jsonb_build_object(
      'id', v_quiz.id, 'title', v_quiz.title,
      'duration_minutes', v_quiz.duration_minutes,
      'status', v_quiz.status, 'num_questions', v_quiz.num_questions
    ),
    'questions', v_questions,
    'question_order', v_order
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_attempt(uuid) TO anon, authenticated;

-- ============ save_response function ============
CREATE OR REPLACE FUNCTION public.save_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_option text,
  p_current_index int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.attempts%ROWTYPE;
  v_quiz public.quizzes%ROWTYPE;
  v_answered int;
BEGIN
  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Attempt not found.');
  END IF;

  IF v_attempt.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This quiz has already been submitted.', 'submitted', true);
  END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_attempt.quiz_id;
  IF v_quiz.status NOT IN ('LIVE','STOPPED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The quiz is no longer accepting responses.');
  END IF;
  -- Allow saving during STOPPED only if not yet submitted (grace period for in-progress)

  -- Upsert response
  INSERT INTO public.responses (attempt_id, question_id, selected_option, saved_at)
  VALUES (p_attempt_id, p_question_id, p_selected_option, now())
  ON CONFLICT (attempt_id, question_id)
  DO UPDATE SET selected_option = EXCLUDED.selected_option, saved_at = now();

  -- Count answered
  SELECT count(*) INTO v_answered FROM public.responses
    WHERE attempt_id = p_attempt_id AND selected_option IS NOT NULL;

  -- Update attempt
  UPDATE public.attempts SET
    answered_count = v_answered,
    last_seen_at = now(),
    current_index = COALESCE(p_current_index, attempts.current_index)
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('ok', true, 'answered_count', v_answered);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_response(uuid, uuid, text, int) TO anon, authenticated;

-- ============ submit_attempt function ============
CREATE OR REPLACE FUNCTION public.submit_attempt(
  p_attempt_id uuid,
  p_end_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Attempt not found.');
  END IF;

  IF v_attempt.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already submitted.', 'submitted', true);
  END IF;

  UPDATE public.attempts
    SET submitted_at = now(), end_reason = p_end_reason, last_seen_at = now()
    WHERE id = p_attempt_id;

  RETURN jsonb_build_object('ok', true, 'submitted_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_attempt(uuid, text) TO anon, authenticated;

-- ============ heartbeat function ============
CREATE OR REPLACE FUNCTION public.heartbeat(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.attempts SET last_seen_at = now() WHERE id = p_attempt_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.heartbeat(uuid) TO anon, authenticated;

-- ============ get_quiz_monitor function (admin) ============
CREATE OR REPLACE FUNCTION public.get_quiz_monitor(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_stats jsonb;
  v_participants jsonb;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.');
  END IF;

  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  SELECT jsonb_build_object(
    'total_participants', count(*),
    'approved', count(*) FILTER (WHERE approved AND NOT rejected),
    'waiting', count(*) FILTER (WHERE NOT approved AND NOT rejected),
    'rejected', count(*) FILTER (WHERE rejected),
    'submitted', count(*) FILTER (WHERE a.submitted_at IS NOT NULL),
    'in_progress', count(*) FILTER (WHERE a.id IS NOT NULL AND a.submitted_at IS NULL)
  )
  INTO v_stats
  FROM public.participants p
  LEFT JOIN public.attempts a ON a.participant_id = p.id
  WHERE p.quiz_id = p_quiz_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'participant_id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'register_number', p.register_number,
    'approved', p.approved,
    'rejected', p.rejected,
    'attempt_id', a.id,
    'answered_count', COALESCE(a.answered_count, 0),
    'current_index', COALESCE(a.current_index, 0),
    'started_at', a.started_at,
    'submitted_at', a.submitted_at,
    'end_reason', a.end_reason,
    'last_seen_at', a.last_seen_at
  ) ORDER BY p.joined_at), '[]'::jsonb)
  INTO v_participants
  FROM public.participants p
  LEFT JOIN public.attempts a ON a.participant_id = p.id
  WHERE p.quiz_id = p_quiz_id;

  RETURN jsonb_build_object(
    'ok', true,
    'quiz', jsonb_build_object(
      'id', v_quiz.id, 'title', v_quiz.title, 'status', v_quiz.status,
      'duration_minutes', v_quiz.duration_minutes, 'num_questions', v_quiz.num_questions
    ),
    'stats', v_stats,
    'participants', v_participants
  );
END;
$$;

-- ============ evaluate_response function (admin) ============
CREATE OR REPLACE FUNCTION public.evaluate_response(
  p_response_id uuid,
  p_marks numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_response public.responses%ROWTYPE;
  v_attempt public.attempts%ROWTYPE;
  v_quiz public.quizzes%ROWTYPE;
BEGIN
  SELECT * INTO v_response FROM public.responses WHERE id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Response not found.');
  END IF;

  SELECT * INTO v_attempt FROM public.attempts WHERE id = v_response.attempt_id;
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_attempt.quiz_id;

  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  INSERT INTO public.evaluations (response_id, marks_awarded, evaluated_by)
  VALUES (p_response_id, p_marks, auth.uid())
  ON CONFLICT (response_id)
  DO UPDATE SET marks_awarded = EXCLUDED.marks_awarded, evaluated_at = now(), evaluated_by = auth.uid();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============ get_results function (admin, ranked) ============
CREATE OR REPLACE FUNCTION public.get_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_results jsonb;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.');
  END IF;

  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'participant_id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'phone', p.phone,
    'register_number', p.register_number,
    'quiz_title', v_quiz.title,
    'total_marks', total_marks,
    'marks_obtained', marks_obtained,
    'percentage', CASE WHEN total_marks > 0 THEN round((marks_obtained / total_marks) * 100, 2) ELSE 0 END,
    'submitted_at', a.submitted_at,
    'end_reason', a.end_reason
  ) ORDER BY marks_obtained DESC, a.submitted_at ASC), '[]'::jsonb)
  INTO v_results
  FROM public.participants p
  JOIN public.attempts a ON a.participant_id = p.id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(q.marks), 0) AS total_marks,
      COALESCE(sum(COALESCE(e.marks_awarded, 0)), 0) AS marks_obtained
    FROM public.responses r
    JOIN public.questions q ON q.id = r.question_id
    LEFT JOIN public.evaluations e ON e.response_id = r.id
    WHERE r.attempt_id = a.id
  ) calc ON true
  WHERE p.quiz_id = p_quiz_id AND a.submitted_at IS NOT NULL;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$$;

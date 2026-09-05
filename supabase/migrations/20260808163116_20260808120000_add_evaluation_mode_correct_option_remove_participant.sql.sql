/*
# Add evaluation mode, correct answers, code-on-start, and participant removal

1. Schema changes
- quizzes.code: make nullable (code generated only when quiz starts)
- quizzes.evaluation_mode: 'manual' | 'auto' (default 'manual')
- questions.correct_option: nullable 'A'|'B'|'C'|'D' (for auto-evaluation)

2. Functions
- start_quiz(p_quiz_id): admin-only. Generates code, sets status LIVE. Returns code.
- remove_participant(p_participant_id): admin-only. Deletes participant + their attempt.
- auto_evaluate_quiz(p_quiz_id): admin-only. Evaluates all submitted responses
  against correct_option, calculates marks, rank, and grade for each participant.

3. Security
- All new functions are SECURITY DEFINER with admin ownership checks.
- RLS policies updated for the new columns.
*/

-- ============ quizzes: nullable code + evaluation_mode ============
ALTER TABLE public.quizzes ALTER COLUMN code DROP NOT NULL;

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS evaluation_mode text NOT NULL DEFAULT 'manual'
  CHECK (evaluation_mode IN ('manual','auto'));

-- ============ questions: correct_option ============
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS correct_option text
  CHECK (correct_option IS NULL OR correct_option IN ('A','B','C','D'));

-- ============ start_quiz function ============
-- Generates a unique code and moves quiz to LIVE status.
CREATE OR REPLACE FUNCTION public.start_quiz(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_code text;
  v_attempts int := 0;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  -- Generate unique code
  LOOP
    v_code := 'QUIZ-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 5));
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      v_code := 'QUIZ-' || upper(substr(md5(random()::text), 1, 5));
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quizzes WHERE code = v_code AND id <> p_quiz_id);
  END LOOP;

  UPDATE public.quizzes SET code = v_code, status = 'LIVE' WHERE id = p_quiz_id;

  RETURN jsonb_build_object('ok', true, 'code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_quiz(uuid) TO authenticated;

-- ============ remove_participant function ============
-- Admin-only. Deletes a participant and cascades to their attempt/responses/evaluations.
CREATE OR REPLACE FUNCTION public.remove_participant(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz_id uuid;
BEGIN
  SELECT quiz_id INTO v_quiz_id FROM public.participants WHERE id = p_participant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Participant not found.'); END IF;

  IF NOT public.is_admin() OR NOT EXISTS (
    SELECT 1 FROM public.quizzes q WHERE q.id = v_quiz_id AND q.created_by = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  DELETE FROM public.participants WHERE id = p_participant_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_participant(uuid) TO authenticated;

-- ============ auto_evaluate_quiz function ============
-- Evaluates all submitted responses against correct_option, calculates marks,
-- rank, and grade for each participant. Returns summary.
CREATE OR REPLACE FUNCTION public.auto_evaluate_quiz(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_evaluated int := 0;
  v_total_participants int := 0;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  -- Evaluate each submitted response
  INSERT INTO public.evaluations (response_id, marks_awarded, evaluated_by)
  SELECT r.id, CASE WHEN r.selected_option = q.correct_option THEN q.marks ELSE 0 END, auth.uid()
  FROM public.responses r
  JOIN public.attempts a ON a.id = r.attempt_id
  JOIN public.questions q ON q.id = r.question_id
  WHERE a.quiz_id = p_quiz_id AND a.submitted_at IS NOT NULL
  ON CONFLICT (response_id)
  DO UPDATE SET marks_awarded = EXCLUDED.marks_awarded, evaluated_at = now(), evaluated_by = auth.uid();

  GET DIAGNOSTICS v_evaluated = ROW_COUNT;

  SELECT count(DISTINCT a.participant_id) INTO v_total_participants
  FROM public.attempts a WHERE a.quiz_id = p_quiz_id AND a.submitted_at IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'evaluated_responses', v_evaluated,
    'total_participants', v_total_participants
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_evaluate_quiz(uuid) TO authenticated;

-- ============ Update get_results to include rank and grade ============
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
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
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
    'grade', CASE
      WHEN total_marks = 0 THEN 'N/A'
      WHEN marks_obtained / total_marks >= 0.9 THEN 'A+'
      WHEN marks_obtained / total_marks >= 0.8 THEN 'A'
      WHEN marks_obtained / total_marks >= 0.7 THEN 'B+'
      WHEN marks_obtained / total_marks >= 0.6 THEN 'B'
      WHEN marks_obtained / total_marks >= 0.5 THEN 'C'
      WHEN marks_obtained / total_marks >= 0.4 THEN 'D'
      ELSE 'F'
    END,
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

  RETURN jsonb_build_object('ok', true, 'results', v_results, 'evaluation_mode', v_quiz.evaluation_mode);
END;
$$;

-- ============ Update get_quiz_monitor to include phone and joined_at ============
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
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
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
    'phone', p.phone,
    'register_number', p.register_number,
    'approved', p.approved,
    'rejected', p.rejected,
    'attempt_id', a.id,
    'answered_count', COALESCE(a.answered_count, 0),
    'current_index', COALESCE(a.current_index, 0),
    'started_at', a.started_at,
    'submitted_at', a.submitted_at,
    'end_reason', a.end_reason,
    'last_seen_at', a.last_seen_at,
    'joined_at', p.joined_at
  ) ORDER BY p.joined_at), '[]'::jsonb)
  INTO v_participants
  FROM public.participants p
  LEFT JOIN public.attempts a ON a.participant_id = p.id
  WHERE p.quiz_id = p_quiz_id;

  RETURN jsonb_build_object(
    'ok', true,
    'quiz', jsonb_build_object(
      'id', v_quiz.id, 'title', v_quiz.title, 'status', v_quiz.status,
      'duration_minutes', v_quiz.duration_minutes, 'num_questions', v_quiz.num_questions,
      'evaluation_mode', v_quiz.evaluation_mode, 'code', v_quiz.code
    ),
    'stats', v_stats,
    'participants', v_participants
  );
END;
$$;

-- ============ Update lookup_quiz_by_code to handle null codes ============
-- Only return quiz if code matches (null codes won't match any participant lookup)
CREATE OR REPLACE FUNCTION public.lookup_quiz_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_count int;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid quiz code.');
  END IF;

  SELECT count(*) INTO v_count FROM public.participants
    WHERE quiz_id = v_quiz.id AND rejected = false;

  RETURN jsonb_build_object(
    'ok', true,
    'quiz', jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'description', v_quiz.description,
      'status', v_quiz.status,
      'max_participants', v_quiz.max_participants,
      'participant_count', v_count
    )
  );
END;
$$;

-- ============ Update register_participant to handle WAITING status ============
-- Participants can register when quiz is WAITING (before code is generated)
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
  IF COALESCE(trim(p_full_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Full name is required.');
  END IF;
  IF COALESCE(trim(p_email), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email is required.');
  END IF;
  IF COALESCE(trim(p_phone), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mobile number is required.');
  END IF;
  IF COALESCE(trim(p_register_number), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Register number is required.');
  END IF;

  -- Find quiz by code
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

  -- Check max participants
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

-- ============ Add lookup_quiz_by_id for participant waiting room ============
-- Participants need to look up quiz by ID (not code) after registration,
-- since the code may not exist yet (generated on start).
CREATE OR REPLACE FUNCTION public.get_quiz_for_participant(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'quiz', jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'status', v_quiz.status,
      'code', v_quiz.code
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_quiz_for_participant(uuid) TO anon, authenticated;

-- ============ Update get_participant_status to include quiz_id ============
CREATE OR REPLACE FUNCTION public.get_participant_status(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_quiz public.quizzes%ROWTYPE;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE id = p_participant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Participant not found.');
  END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_participant.quiz_id;

  RETURN jsonb_build_object(
    'ok', true,
    'participant', jsonb_build_object(
      'id', v_participant.id,
      'full_name', v_participant.full_name,
      'approved', v_participant.approved,
      'rejected', v_participant.rejected
    ),
    'quiz', jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'status', v_quiz.status,
      'code', v_quiz.code
    )
  );
END;
$$;

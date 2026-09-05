-- Add device_mode to quizzes and allow editing duration after start.
-- device_mode: 'laptop' | 'mobile' | 'both'

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS device_mode text NOT NULL DEFAULT 'both';

-- start_quiz now accepts a device mode parameter
CREATE OR REPLACE FUNCTION public.start_quiz(p_quiz_id uuid, p_device_mode text DEFAULT 'both')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  UPDATE public.quizzes
    SET status = 'LIVE',
        device_mode = COALESCE(NULLIF(trim(p_device_mode), ''), v_quiz.device_mode, 'both')
    WHERE id = p_quiz_id;

  RETURN jsonb_build_object('ok', true, 'code', v_quiz.code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_quiz(uuid, text) TO authenticated;

-- Allow admin to update quiz duration even after the quiz has started
CREATE OR REPLACE FUNCTION public.update_quiz_duration(p_quiz_id uuid, p_duration_minutes int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;
  IF p_duration_minutes < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Duration must be at least 1 minute.');
  END IF;

  UPDATE public.quizzes SET duration_minutes = p_duration_minutes WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_quiz_duration(uuid, int) TO authenticated;

-- Update get_quiz_monitor to include device_mode
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
    'waiting', count(*) FILTER (WHERE NOT approved AND NOT rejected AND rejoin_requested_at IS NULL),
    'rejected', count(*) FILTER (WHERE rejected),
    'submitted', count(*) FILTER (WHERE a.submitted_at IS NOT NULL AND p.rejoin_requested_at IS NULL),
    'in_progress', count(*) FILTER (WHERE a.id IS NOT NULL AND a.submitted_at IS NULL),
    'rejoin_pending', count(*) FILTER (WHERE p.rejoin_requested_at IS NOT NULL AND p.rejoin_approved_at IS NULL)
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
    'joined_at', p.joined_at,
    'rejoin_requested', p.rejoin_requested_at IS NOT NULL,
    'rejoin_approved', p.rejoin_approved_at IS NOT NULL,
    'rejoin_requested_at', p.rejoin_requested_at
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
      'evaluation_mode', v_quiz.evaluation_mode, 'code', v_quiz.code,
      'device_mode', v_quiz.device_mode
    ),
    'stats', v_stats, 'participants', v_participants
  );
END;
$$;

-- Update start_attempt to return device_mode
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
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Participant not found.'); END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_participant.quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF v_quiz.status <> 'LIVE' THEN RETURN jsonb_build_object('ok', false, 'error', 'The quiz has not started yet.'); END IF;
  IF NOT v_participant.approved THEN RETURN jsonb_build_object('ok', false, 'error', 'You have not been approved to take this quiz.'); END IF;
  IF v_participant.rejected THEN RETURN jsonb_build_object('ok', false, 'error', 'Your registration was rejected.'); END IF;

  SELECT * INTO v_existing FROM public.attempts
    WHERE participant_id = p_participant_id
    ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_existing.submitted_at IS NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', q.id, 'text', q.text, 'option_a', q.option_a, 'option_b', q.option_b,
        'option_c', q.option_c, 'option_d', q.option_d, 'marks', q.marks, 'position', ord.position
      ) ORDER BY ord.position), '[]'::jsonb)
      INTO v_questions
      FROM jsonb_array_elements_text(v_existing.question_order) WITH ORDINALITY AS ord(id, position)
      JOIN public.questions q ON q.id::text = ord.id;

      RETURN jsonb_build_object('ok', true,
        'attempt', jsonb_build_object('id', v_existing.id, 'current_index', v_existing.current_index, 'answered_count', v_existing.answered_count, 'started_at', v_existing.started_at, 'submitted_at', v_existing.submitted_at),
        'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions, 'device_mode', v_quiz.device_mode),
        'questions', v_questions, 'question_order', v_existing.question_order);
    END IF;

    IF v_participant.rejoin_approved_at IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(q.id::text ORDER BY random()), '[]'::jsonb)
      INTO v_order FROM public.questions q WHERE q.quiz_id = v_quiz.id;
      IF jsonb_array_length(v_order) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No questions have been added to this quiz yet.');
      END IF;

      INSERT INTO public.attempts (quiz_id, participant_id, question_order, started_at, last_seen_at)
      VALUES (v_quiz.id, p_participant_id, v_order, now(), now())
      RETURNING * INTO v_attempt;

      UPDATE public.participants
        SET rejoin_requested_at = NULL, rejoin_approved_at = NULL
        WHERE id = p_participant_id;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', q.id, 'text', q.text, 'option_a', q.option_a, 'option_b', q.option_b,
        'option_c', q.option_c, 'option_d', q.option_d, 'marks', q.marks, 'position', ord.position
      ) ORDER BY ord.position), '[]'::jsonb)
      INTO v_questions
      FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS ord(id, position)
      JOIN public.questions q ON q.id::text = ord.id;

      RETURN jsonb_build_object('ok', true,
        'attempt', jsonb_build_object('id', v_attempt.id, 'current_index', 0, 'answered_count', 0, 'started_at', v_attempt.started_at, 'submitted_at', null),
        'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions, 'device_mode', v_quiz.device_mode),
        'questions', v_questions, 'question_order', v_order);
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this quiz.', 'submitted', true);
  END IF;

  SELECT COALESCE(jsonb_agg(q.id::text ORDER BY random()), '[]'::jsonb)
  INTO v_order FROM public.questions q WHERE q.quiz_id = v_quiz.id;
  IF jsonb_array_length(v_order) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No questions have been added to this quiz yet.');
  END IF;

  INSERT INTO public.attempts (quiz_id, participant_id, question_order, started_at, last_seen_at)
  VALUES (v_quiz.id, p_participant_id, v_order, now(), now())
  RETURNING * INTO v_attempt;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'text', q.text, 'option_a', q.option_a, 'option_b', q.option_b,
    'option_c', q.option_c, 'option_d', q.option_d, 'marks', q.marks, 'position', ord.position
  ) ORDER BY ord.position), '[]'::jsonb)
  INTO v_questions
  FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS ord(id, position)
  JOIN public.questions q ON q.id::text = ord.id;

  RETURN jsonb_build_object('ok', true,
    'attempt', jsonb_build_object('id', v_attempt.id, 'current_index', 0, 'answered_count', 0, 'started_at', v_attempt.started_at, 'submitted_at', null),
    'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions, 'device_mode', v_quiz.device_mode),
    'questions', v_questions, 'question_order', v_order);
END;
$$;

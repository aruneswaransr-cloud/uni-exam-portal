-- Add department to participants, add admin edit function, update get_results with department + tie-break by submission time

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS department text;

-- Update register_participant to accept department
CREATE OR REPLACE FUNCTION public.register_participant(
  p_quiz_code text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_register_number text,
  p_department text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_participant public.participants%ROWTYPE;
  v_existing public.participants%ROWTYPE;
  v_attempt public.attempts%ROWTYPE;
  v_count int;
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

  SELECT * INTO v_quiz FROM public.quizzes WHERE code = upper(trim(p_quiz_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid quiz code. Please check and try again.');
  END IF;

  IF v_quiz.status NOT IN ('DRAFT', 'WAITING', 'LIVE') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE v_quiz.status
        WHEN 'STOPPED' THEN 'This quiz is no longer accepting participants.'
        WHEN 'COMPLETED' THEN 'This quiz has been completed.'
        ELSE 'This quiz is not open for registration.'
      END);
  END IF;

  SELECT * INTO v_existing FROM public.participants
    WHERE quiz_id = v_quiz.id AND register_number = trim(p_register_number) LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_attempt FROM public.attempts
      WHERE participant_id = v_existing.id AND submitted_at IS NOT NULL
      ORDER BY submitted_at DESC LIMIT 1;

    IF FOUND THEN
      UPDATE public.participants
        SET rejoin_requested_at = now(), rejoin_approved_at = NULL,
            department = COALESCE(NULLIF(trim(p_department), ''), v_existing.department)
        WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'ok', true,
        'rejoin', true,
        'participant', jsonb_build_object(
          'id', v_existing.id,
          'quiz_id', v_existing.quiz_id,
          'full_name', v_existing.full_name,
          'approved', v_existing.approved,
          'rejected', v_existing.rejected
        ),
        'quiz', jsonb_build_object(
          'id', v_quiz.id,
          'title', v_quiz.title,
          'status', v_quiz.status
        )
      );
    END IF;

    RETURN jsonb_build_object('ok', false, 'error',
      'You have already registered for this quiz with this register number.');
  END IF;

  SELECT id INTO v_existing FROM public.participants
    WHERE quiz_id = v_quiz.id AND lower(email) = lower(trim(p_email)) LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'This email has already been used to register for this quiz.');
  END IF;

  SELECT count(*) INTO v_count FROM public.participants
    WHERE quiz_id = v_quiz.id AND rejected = false;
  IF v_count >= v_quiz.max_participants THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This quiz has reached its maximum participant limit.');
  END IF;

  INSERT INTO public.participants (quiz_id, full_name, email, phone, register_number, department)
  VALUES (v_quiz.id, trim(p_full_name), lower(trim(p_email)), trim(p_phone), trim(p_register_number), trim(p_department))
  RETURNING * INTO v_participant;

  RETURN jsonb_build_object(
    'ok', true,
    'rejoin', false,
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

-- Admin can update participant info (fill missing data) during or after quiz
CREATE OR REPLACE FUNCTION public.update_participant_info(
  p_participant_id uuid,
  p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_register_number text DEFAULT NULL,
  p_department text DEFAULT NULL
)
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
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.');
  END IF;

  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  UPDATE public.participants SET
    full_name = COALESCE(NULLIF(trim(p_full_name), ''), full_name),
    email = COALESCE(NULLIF(trim(p_email), ''), email),
    phone = COALESCE(NULLIF(trim(p_phone), ''), phone),
    register_number = COALESCE(NULLIF(trim(p_register_number), ''), register_number),
    department = COALESCE(NULLIF(trim(p_department), ''), department)
  WHERE id = p_participant_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_participant_info(uuid, text, text, text, text, text) TO authenticated;

-- Update get_quiz_monitor to include department
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
    'department', p.department,
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

-- Update get_results to include department and submission duration for tie-breaking
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
    'department', COALESCE(p.department, ''),
    'quiz_title', v_quiz.title,
    'total_marks', COALESCE(sum(e.marks_awarded), 0) + (
      SELECT COALESCE(sum(q.marks), 0) FROM public.questions q
      JOIN public.attempts a2 ON a2.id = a.id
      WHERE q.quiz_id = v_quiz.id
      AND NOT EXISTS (
        SELECT 1 FROM public.responses r2
        JOIN public.evaluations e2 ON e2.response_id = r2.id
        WHERE r2.attempt_id = a.id AND r2.question_id = q.id
      )
    ),
    'marks_obtained', COALESCE(sum(e.marks_awarded), 0),
    'percentage', CASE
      WHEN (SELECT COALESCE(sum(qq.marks), 0) FROM public.questions qq WHERE qq.quiz_id = v_quiz.id) = 0 THEN 0
      ELSE ROUND(100.0 * COALESCE(sum(e.marks_awarded), 0) /
        (SELECT COALESCE(sum(qq.marks), 0) FROM public.questions qq WHERE qq.quiz_id = v_quiz.id), 2)
    END,
    'submitted_at', a.submitted_at,
    'end_reason', a.end_reason,
    'time_taken_seconds', EXTRACT(EPOCH FROM (a.submitted_at - a.started_at))::int
  ) ORDER BY p.full_name), '[]'::jsonb)
  INTO v_results
  FROM public.participants p
  JOIN public.attempts a ON a.participant_id = p.id AND a.submitted_at IS NOT NULL
  LEFT JOIN public.responses r ON r.attempt_id = a.id
  LEFT JOIN public.evaluations e ON e.response_id = r.id
  WHERE p.quiz_id = p_quiz_id
  GROUP BY p.id, a.id, a.submitted_at, a.started_at, a.end_reason;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$$;

-- Rejoin feature: after a participant's quiz is submitted (tab switch, timeout, etc.),
-- they can re-enter the quiz by re-joining with the same code. The admin must approve
-- the rejoin before they can start a new attempt.

-- ============ Add rejoin columns to participants ============
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS rejoin_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejoin_approved_at timestamptz;

-- Index for finding pending rejoin requests quickly
CREATE INDEX IF NOT EXISTS idx_participants_rejoin_pending
  ON public.participants (quiz_id)
  WHERE rejoin_requested_at IS NOT NULL AND rejoin_approved_at IS NULL;

-- ============ register_participant: handle rejoin ============
-- If a participant already exists with a submitted attempt, mark rejoin_requested
-- instead of returning a duplicate error.
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

  -- Find quiz by code
  SELECT * INTO v_quiz FROM public.quizzes WHERE code = upper(trim(p_quiz_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid quiz code. Please check and try again.');
  END IF;

  -- Quiz must be in DRAFT or WAITING or LIVE status to join or rejoin
  IF v_quiz.status NOT IN ('DRAFT', 'WAITING', 'LIVE') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE v_quiz.status
        WHEN 'STOPPED' THEN 'This quiz is no longer accepting participants.'
        WHEN 'COMPLETED' THEN 'This quiz has been completed.'
        ELSE 'This quiz is not open for registration.'
      END);
  END IF;

  -- Check for existing participant with same register number
  SELECT * INTO v_existing FROM public.participants
    WHERE quiz_id = v_quiz.id AND register_number = trim(p_register_number) LIMIT 1;

  IF FOUND THEN
    -- Check if they have a submitted attempt (rejoin scenario)
    SELECT * INTO v_attempt FROM public.attempts
      WHERE participant_id = v_existing.id AND submitted_at IS NOT NULL
      ORDER BY submitted_at DESC LIMIT 1;

    IF FOUND THEN
      -- Rejoin request: mark rejoin_requested
      UPDATE public.participants
        SET rejoin_requested_at = now(), rejoin_approved_at = NULL
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

    -- Already registered but not submitted — duplicate
    RETURN jsonb_build_object('ok', false, 'error',
      'You have already registered for this quiz with this register number.');
  END IF;

  -- Duplicate email check
  SELECT id INTO v_existing FROM public.participants
    WHERE quiz_id = v_quiz.id AND lower(email) = lower(trim(p_email)) LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'This email has already been used to register for this quiz.');
  END IF;

  -- Check max participants
  SELECT count(*) INTO v_count FROM public.participants
    WHERE quiz_id = v_quiz.id AND rejected = false;
  IF v_count >= v_quiz.max_participants THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This quiz has reached its maximum participant limit.');
  END IF;

  -- Insert new participant
  INSERT INTO public.participants (quiz_id, full_name, email, phone, register_number)
  VALUES (v_quiz.id, trim(p_full_name), lower(trim(p_email)), trim(p_phone), trim(p_register_number))
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

-- ============ allow_rejoin: admin approves a rejoin request ============
CREATE OR REPLACE FUNCTION public.allow_rejoin(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_quiz public.quizzes%ROWTYPE;
  v_old_attempt public.attempts%ROWTYPE;
  v_new_attempt public.attempts%ROWTYPE;
  v_order jsonb;
  v_questions jsonb;
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

  IF v_participant.rejoin_requested_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This participant has not requested a rejoin.');
  END IF;

  IF v_quiz.status <> 'LIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz must be live to allow rejoin.');
  END IF;

  -- Mark rejoin approved
  UPDATE public.participants
    SET rejoin_approved_at = now(), approved = true, rejected = false
    WHERE id = p_participant_id;

  -- Mark old submitted attempt as superseded (keep it for records)
  -- The start_attempt function will create a new attempt since the old one is submitted
  -- We need to ensure start_attempt doesn't find the old submitted attempt and block
  -- Actually, start_attempt checks: if existing attempt submitted_at IS NOT NULL, returns error
  -- We need to modify start_attempt to handle rejoin-approved participants

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.allow_rejoin(uuid) TO authenticated;

-- ============ start_attempt: handle rejoin ============
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

  -- Find the most recent attempt
  SELECT * INTO v_existing FROM public.attempts
    WHERE participant_id = p_participant_id
    ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    -- If the latest attempt is not submitted, resume it
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
        'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions),
        'questions', v_questions, 'question_order', v_existing.question_order);
    END IF;

    -- Latest attempt is submitted. Check if rejoin is approved.
    IF v_participant.rejoin_approved_at IS NOT NULL THEN
      -- Create a new attempt for the rejoin
      SELECT COALESCE(jsonb_agg(q.id::text ORDER BY random()), '[]'::jsonb)
      INTO v_order FROM public.questions q WHERE q.quiz_id = v_quiz.id;
      IF jsonb_array_length(v_order) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No questions have been added to this quiz yet.');
      END IF;

      INSERT INTO public.attempts (quiz_id, participant_id, question_order, started_at, last_seen_at)
      VALUES (v_quiz.id, p_participant_id, v_order, now(), now())
      RETURNING * INTO v_attempt;

      -- Clear rejoin flags so they can't rejoin again without a new request
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
        'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions),
        'questions', v_questions, 'question_order', v_order);
    END IF;

    -- Submitted but no rejoin approved
    RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this quiz.', 'submitted', true);
  END IF;

  -- No existing attempt — create new
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
    'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions),
    'questions', v_questions, 'question_order', v_order);
END;
$$;

-- ============ get_participant_status: include rejoin fields ============
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
      'rejected', v_participant.rejected,
      'rejoin_requested', v_participant.rejoin_requested_at IS NOT NULL,
      'rejoin_approved', v_participant.rejoin_approved_at IS NOT NULL
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

-- ============ get_quiz_monitor: include rejoin fields ============
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
      'evaluation_mode', v_quiz.evaluation_mode, 'code', v_quiz.code
    ),
    'stats', v_stats, 'participants', v_participants
  );
END;
$$;

-- Generate quiz code at creation time instead of at start time.
-- 1. New function: generate_quiz_code() returns a unique QUIZ-XXXXX code.
-- 2. start_quiz() no longer generates a code; it just moves status to LIVE.
-- 3. register_participant() now accepts quizzes in DRAFT or WAITING status
--    (so participants can register as soon as the quiz is created).

-- ============ generate_quiz_code ============
CREATE OR REPLACE FUNCTION public.generate_quiz_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code text;
  v_attempts int := 0;
BEGIN
  LOOP
    v_code := 'QUIZ-' || upper(substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 5));
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      v_code := 'QUIZ-' || upper(substr(md5(random()::text), 1, 5));
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quizzes WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_quiz_code() TO authenticated;

-- ============ start_quiz: no longer generates code ============
CREATE OR REPLACE FUNCTION public.start_quiz(p_quiz_id uuid)
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

  -- Just move to LIVE; code was already generated at creation time
  UPDATE public.quizzes SET status = 'LIVE' WHERE id = p_quiz_id;

  RETURN jsonb_build_object('ok', true, 'code', v_quiz.code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_quiz(uuid) TO authenticated;

-- ============ register_participant: allow DRAFT and WAITING ============
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

  -- Quiz must be in DRAFT or WAITING status to join
  IF v_quiz.status NOT IN ('DRAFT', 'WAITING') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE v_quiz.status
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

-- ============ lookup_quiz_by_code: allow DRAFT status too ============
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

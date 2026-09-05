-- Allow participants to register with the same email across different quizzes
-- and within the same quiz (multiple participants can share an email).
-- The register_number is still used as the unique key per quiz for rejoin logic.
-- Remove the email uniqueness check from register_participant.

CREATE OR REPLACE FUNCTION public.register_participant(
  p_quiz_code text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_register_number text,
  p_department text DEFAULT '',
  p_custom_fields jsonb DEFAULT '{}'::jsonb
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

  -- Check by register_number for rejoin logic
  SELECT * INTO v_existing FROM public.participants
  WHERE quiz_id = v_quiz.id AND register_number = trim(p_register_number) LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_attempt FROM public.attempts
    WHERE participant_id = v_existing.id AND submitted_at IS NOT NULL
    ORDER BY submitted_at DESC LIMIT 1;

    IF FOUND THEN
      UPDATE public.participants
      SET rejoin_requested_at = now(), rejoin_approved_at = NULL,
        department = COALESCE(NULLIF(trim(p_department), ''), v_existing.department),
        custom_fields = CASE
          WHEN p_custom_fields IS NOT NULL AND p_custom_fields::text <> '{}'
          THEN p_custom_fields
          ELSE v_existing.custom_fields
        END
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

  -- Email uniqueness check removed — same email is now allowed

  SELECT count(*) INTO v_count FROM public.participants
  WHERE quiz_id = v_quiz.id AND rejected = false;
  IF v_count >= v_quiz.max_participants THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This quiz has reached its maximum participant limit.');
  END IF;

  INSERT INTO public.participants (quiz_id, full_name, email, phone, register_number, department, custom_fields)
  VALUES (v_quiz.id, trim(p_full_name), lower(trim(p_email)), trim(p_phone), trim(p_register_number), trim(p_department),
    COALESCE(p_custom_fields, '{}'::jsonb))
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

GRANT EXECUTE ON FUNCTION public.register_participant(text, text, text, text, text, text, jsonb) TO anon, authenticated;

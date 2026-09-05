/*
# Fix rejoin: match by email OR register number, update all details on rejoin

The register_participant function now:
1. Matches existing participants by register_number OR email (not just register_number)
2. When rejoining, updates all participant details (full_name, email, phone, department, custom_fields)
3. Returns rejoin_requested and rejoin_approved in the participant object
4. Removes the old overloads to avoid ambiguity
*/

DROP FUNCTION IF EXISTS public.register_participant(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.register_participant(text, text, text, text, text, text);

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
SET search_path TO 'public'
AS $function$
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

  -- Check by register_number OR email for rejoin logic
  SELECT * INTO v_existing FROM public.participants
  WHERE quiz_id = v_quiz.id
    AND (register_number = trim(p_register_number) OR lower(email) = lower(trim(p_email)))
  LIMIT 1;

  IF FOUND THEN
    -- Check if they have a submitted attempt (rejoin scenario)
    SELECT * INTO v_attempt FROM public.attempts
    WHERE participant_id = v_existing.id AND submitted_at IS NOT NULL
    ORDER BY submitted_at DESC LIMIT 1;

    IF FOUND THEN
      -- Rejoin request: update all details and mark rejoin_requested
      UPDATE public.participants
      SET rejoin_requested_at = now(),
          rejoin_approved_at = NULL,
          full_name = COALESCE(NULLIF(trim(p_full_name), ''), v_existing.full_name),
          email = COALESCE(NULLIF(lower(trim(p_email)), ''), v_existing.email),
          phone = COALESCE(NULLIF(trim(p_phone), ''), v_existing.phone),
          register_number = COALESCE(NULLIF(trim(p_register_number), ''), v_existing.register_number),
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
          'full_name', COALESCE(NULLIF(trim(p_full_name), ''), v_existing.full_name),
          'approved', v_existing.approved,
          'rejected', v_existing.rejected,
          'rejoin_requested', true,
          'rejoin_approved', false
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
      'You have already registered for this quiz. Please wait for the admin to approve you.');
  END IF;

  -- Check max participants
  SELECT count(*) INTO v_count FROM public.participants
  WHERE quiz_id = v_quiz.id AND rejected = false;
  IF v_count >= v_quiz.max_participants THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This quiz has reached its maximum participant limit.');
  END IF;

  -- Insert new participant
  INSERT INTO public.participants (quiz_id, full_name, email, phone, register_number, department, custom_fields)
  VALUES (v_quiz.id, trim(p_full_name), lower(trim(p_email)), trim(p_phone), trim(p_register_number),
          trim(p_department), COALESCE(p_custom_fields, '{}'::jsonb))
  RETURNING * INTO v_participant;

  RETURN jsonb_build_object(
    'ok', true,
    'rejoin', false,
    'participant', jsonb_build_object(
      'id', v_participant.id,
      'quiz_id', v_participant.quiz_id,
      'full_name', v_participant.full_name,
      'approved', v_participant.approved,
      'rejected', v_participant.rejected,
      'rejoin_requested', false,
      'rejoin_approved', false
    ),
    'quiz', jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'status', v_quiz.status
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.register_participant(text, text, text, text, text, text, jsonb) TO anon, authenticated;

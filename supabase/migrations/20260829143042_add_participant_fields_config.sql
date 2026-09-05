/*
# Add configurable participant detail fields to quizzes

1. Changes
- Add `participant_fields` jsonb column to `public.quizzes` — stores the admin's
  field configuration as a JSON array of field definitions. Each definition has:
  { id, label, type: 'text'|'select', required: bool, choices: string[] }
  The five default identity fields (full_name, email, phone, register_number,
  department) are always present and can be toggled required/optional but not
  removed. Custom fields can be added/removed freely.
- Add `custom_fields` jsonb column to `public.participants` — stores the
  participant's answers to custom fields as a key-value object keyed by field id.

2. Function updates
- `register_participant` now accepts `p_custom_fields` (jsonb) and stores it.
- `lookup_quiz_by_code` now returns `participant_fields` so the registration
  form can render the configured fields.
- `get_quiz_monitor` now returns each participant's `custom_fields`.
- `update_participant_info` now accepts `p_custom_fields` (jsonb) for editing.

3. Security
- No RLS changes — existing policies cover the new columns.
*/

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS participant_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Return participant_fields from lookup_quiz_by_code
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
      'participant_count', v_count,
      'participant_fields', COALESCE(v_quiz.participant_fields, '[]'::jsonb)
    )
  );
END;
$$;

-- Update register_participant to accept custom fields
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

-- Update get_quiz_monitor to include custom_fields
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
    'custom_fields', p.custom_fields,
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
      'device_mode', v_quiz.device_mode,
      'participant_fields', COALESCE(v_quiz.participant_fields, '[]'::jsonb)
    ),
    'stats', v_stats, 'participants', v_participants
  );
END;
$$;

-- Update update_participant_info to accept custom fields
CREATE OR REPLACE FUNCTION public.update_participant_info(
  p_participant_id uuid,
  p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_register_number text DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_custom_fields jsonb DEFAULT NULL
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
    department = COALESCE(NULLIF(trim(p_department), ''), department),
    custom_fields = COALESCE(p_custom_fields, custom_fields)
  WHERE id = p_participant_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_participant_info(uuid, text, text, text, text, text, jsonb) TO authenticated;

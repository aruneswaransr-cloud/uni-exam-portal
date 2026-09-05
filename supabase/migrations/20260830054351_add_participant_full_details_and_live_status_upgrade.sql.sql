-- 1. Update get_participant_status to include duration_minutes, device_mode, and rejoin flags
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
      'duration_minutes', v_quiz.duration_minutes,
      'device_mode', v_quiz.device_mode
    )
  );
END;
$$;

-- 2. Create get_participant_full_details for the standalone details popup window
CREATE OR REPLACE FUNCTION public.get_participant_full_details(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_quiz public.quizzes%ROWTYPE;
  v_attempt public.attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE id = p_participant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Participant not found.');
  END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_participant.quiz_id;
  SELECT * INTO v_attempt FROM public.attempts WHERE participant_id = p_participant_id ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'participant', jsonb_build_object(
      'id', v_participant.id,
      'full_name', v_participant.full_name,
      'email', v_participant.email,
      'phone', v_participant.phone,
      'register_number', v_participant.register_number,
      'department', v_participant.department,
      'approved', v_participant.approved,
      'rejected', v_participant.rejected,
      'joined_at', v_participant.joined_at,
      'custom_fields', v_participant.custom_fields
    ),
    'quiz', jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'status', v_quiz.status,
      'participant_fields', v_quiz.participant_fields
    ),
    'attempt', CASE WHEN v_attempt.id IS NOT NULL THEN jsonb_build_object(
      'id', v_attempt.id,
      'current_index', v_attempt.current_index,
      'answered_count', v_attempt.answered_count,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at,
      'end_reason', v_attempt.end_reason,
      'last_seen_at', v_attempt.last_seen_at
    ) ELSE NULL END,
    'rejoin_requested_at', v_participant.rejoin_requested_at,
    'rejoin_approved_at', v_participant.rejoin_approved_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_participant_full_details(uuid) TO authenticated;

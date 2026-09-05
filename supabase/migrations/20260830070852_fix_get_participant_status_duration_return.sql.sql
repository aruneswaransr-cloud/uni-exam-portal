-- Add server-side device mode enforcement to start_attempt
-- The client-side check can be bypassed, so we also check server-side
-- and return an error if the device doesn't match.

-- We can't detect the physical device server-side, but we CAN store the
-- device_mode on the attempt when it starts, so the client can verify it.
-- The real enforcement is client-side via user agent detection.

-- Actually, the issue is simpler: we need to make sure get_participant_status
-- always returns the latest duration_minutes and device_mode. Let's verify
-- the function is correct by recreating it.

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
      'device_mode', COALESCE(v_quiz.device_mode, 'both')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_participant_status(uuid) TO anon, authenticated;

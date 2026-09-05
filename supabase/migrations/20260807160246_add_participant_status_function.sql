/*
# Add participant status lookup function + waiting room data

1. Purpose
- Participants are not signed-in users, so they cannot rely on auth.uid()-based RLS.
  They need to poll their own approval status and the quiz status while in the
  waiting room.
- This function returns the participant's own data plus the quiz title/status,
  keyed by the participant's UUID (which the client received at registration time).
- It exposes only the calling participant's own row — no other participants' data.

2. Functions
- `get_participant_status(p_participant_id uuid)` — SECURITY DEFINER, returns
  jsonb with participant approval/rejected flags + quiz title/status.
*/

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
      'status', v_quiz.status
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_participant_status(uuid) TO anon, authenticated;

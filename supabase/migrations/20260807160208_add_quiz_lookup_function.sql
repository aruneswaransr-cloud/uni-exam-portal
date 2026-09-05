/*
# Add public quiz code lookup function

1. Purpose
- Participants are not signed in, so they cannot read the quizzes table directly
  (it's admin-only). This function lets a participant look up a quiz by its code
  to see the title and status before registering.
- Returns only the minimal fields needed for the registration UI: id, title,
  description, status, max_participants, and current participant count.
- Does NOT expose admin identity, questions, or other participants.

2. Functions
- `lookup_quiz_by_code(p_code text)` — SECURITY DEFINER, read-only, returns
  jsonb with title/status/description or an error if not found.
*/

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

GRANT EXECUTE ON FUNCTION public.lookup_quiz_by_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_participant(text,text,text,text,text) TO anon, authenticated;

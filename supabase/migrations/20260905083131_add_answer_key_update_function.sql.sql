/*
# Bulk update question correct options (answer key upload)

1. New Functions
- `update_answer_key(p_quiz_id uuid, p_answers jsonb)` — bulk-updates the
  `correct_option` column on existing questions for a quiz.
  - Accepts an array of objects: `{ "question_id": "...", "correct_option": "A"|"B"|"C"|"D" }`.
  - Also accepts a simpler form: `{ "position": 1, "correct_option": "A" }` which
    matches questions by their `position` column (1-indexed order in the quiz).
  - Only updates questions that belong to the specified quiz and are owned by
    the calling admin.
  - Returns `{ ok, updated, skipped, errors }`.
2. Security
- SECURITY DEFINER, `search_path = public`.
- Verifies the caller is an admin and owns the quiz.
*/

CREATE OR REPLACE FUNCTION public.update_answer_key(p_quiz_id uuid, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_item jsonb;
  v_question_id uuid;
  v_position int;
  v_correct text;
  v_updated int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.');
  END IF;
  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  IF jsonb_typeof(p_answers) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Answers must be an array.');
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_answers)
  LOOP
    v_correct := upper(v_item->>'correct_option');
    IF v_correct NOT IN ('A', 'B', 'C', 'D') THEN
      v_errors := v_errors || jsonb_build_object('error', 'Invalid correct_option', 'item', v_item);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_question_id := nullif(v_item->>'question_id', '');
    v_position := nullif(v_item->>'position', '')::int;

    IF v_question_id IS NOT NULL THEN
      UPDATE public.questions
      SET correct_option = v_correct
      WHERE id = v_question_id AND quiz_id = p_quiz_id;
      IF FOUND THEN
        v_updated := v_updated + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSIF v_position IS NOT NULL THEN
      UPDATE public.questions
      SET correct_option = v_correct
      WHERE quiz_id = p_quiz_id AND position = v_position;
      IF FOUND THEN
        v_updated := v_updated + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'updated', v_updated,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_answer_key(uuid, jsonb) TO authenticated;

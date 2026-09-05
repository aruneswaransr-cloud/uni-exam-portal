/*
# Fix rejoin: reset existing attempt instead of inserting a duplicate

## Problem
The `attempts` table has a `UNIQUE (quiz_id, participant_id)` constraint.
When a participant is approved for rejoin, `start_attempt` tried to INSERT
a brand-new attempt row for the same quiz+participant. Postgres rejected
this with a unique-violation, so rejoin always failed.

## Fix
When rejoin is approved and the participant calls `start_attempt`, the
function now UPDATEs the existing submitted attempt in place:
- Generates a fresh shuffled question order
- Clears submitted_at, end_reason, current_index, answered_count
- Resets started_at and last_seen_at to now()
- Deletes the old responses (and their evaluations via cascade) so the
  new attempt starts clean

This keeps the unique constraint intact, avoids a schema change, and
preserves the attempt id that results/monitor functions already join on.

## Data safety
- No tables, columns, or constraints are changed.
- Old responses for the reset attempt are deleted (they belong to the
  superseded submission and would be stale after rejoin). Their
  evaluations cascade-delete with them.
- The participant's rejoin flags are cleared so they cannot rejoin again
  without a new request.

## Security
- `start_attempt` remains SECURITY DEFINER, anon+authenticated executable.
- No policy changes.
*/

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
  v_attempt_id uuid;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE id = p_participant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Participant not found.'); END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_participant.quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF v_quiz.status <> 'LIVE' THEN RETURN jsonb_build_object('ok', false, 'error', 'The quiz has not started yet.'); END IF;
  IF NOT v_participant.approved THEN RETURN jsonb_build_object('ok', false, 'error', 'You have not been approved to take this quiz.'); END IF;
  IF v_participant.rejected THEN RETURN jsonb_build_object('ok', false, 'error', 'Your registration was rejected.'); END IF;

  SELECT * INTO v_existing FROM public.attempts
    WHERE participant_id = p_participant_id
    ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
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
        'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions, 'device_mode', v_quiz.device_mode),
        'questions', v_questions, 'question_order', v_existing.question_order);
    END IF;

    IF v_participant.rejoin_approved_at IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(q.id::text ORDER BY random()), '[]'::jsonb)
      INTO v_order FROM public.questions q WHERE q.quiz_id = v_quiz.id;
      IF jsonb_array_length(v_order) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No questions have been added to this quiz yet.');
      END IF;

      DELETE FROM public.responses WHERE attempt_id = v_existing.id;

      UPDATE public.attempts
        SET question_order = v_order,
            started_at = now(),
            submitted_at = NULL,
            end_reason = NULL,
            current_index = 0,
            answered_count = 0,
            last_seen_at = now()
        WHERE id = v_existing.id
        RETURNING id INTO v_attempt_id;

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
        'attempt', jsonb_build_object('id', v_attempt_id, 'current_index', 0, 'answered_count', 0, 'started_at', now(), 'submitted_at', null),
        'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions, 'device_mode', v_quiz.device_mode),
        'questions', v_questions, 'question_order', v_order);
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this quiz.', 'submitted', true);
  END IF;

  SELECT COALESCE(jsonb_agg(q.id::text ORDER BY random()), '[]'::jsonb)
  INTO v_order FROM public.questions q WHERE q.quiz_id = v_quiz.id;
  IF jsonb_array_length(v_order) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No questions have been added to this quiz yet.');
  END IF;

  INSERT INTO public.attempts (quiz_id, participant_id, question_order, started_at, last_seen_at)
  VALUES (v_quiz.id, p_participant_id, v_order, now(), now())
  RETURNING id INTO v_attempt_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'text', q.text, 'option_a', q.option_a, 'option_b', q.option_b,
    'option_c', q.option_c, 'option_d', q.option_d, 'marks', q.marks, 'position', ord.position
  ) ORDER BY ord.position), '[]'::jsonb)
  INTO v_questions
  FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS ord(id, position)
  JOIN public.questions q ON q.id::text = ord.id;

  RETURN jsonb_build_object('ok', true,
    'attempt', jsonb_build_object('id', v_attempt_id, 'current_index', 0, 'answered_count', 0, 'started_at', now(), 'submitted_at', null),
    'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions, 'device_mode', v_quiz.device_mode),
    'questions', v_questions, 'question_order', v_order);
END;
$$;

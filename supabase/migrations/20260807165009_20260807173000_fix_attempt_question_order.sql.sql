/*
# Fix participant question ordering and preserve individualized quiz sequences

1. Functions
- Rebuild `start_attempt` question retrieval using PostgreSQL JSON array expansion.
- Keep a random question order permanently on each participant attempt.
- Resume an existing attempt with exactly the same stored order.

2. Security
- Preserve SECURITY DEFINER execution and the existing participant approval and LIVE quiz checks.
- Preserve the existing anon/authenticated RPC access required by the participant screen.

3. Important Notes
- New attempts receive a fresh random order from the quiz question bank.
- Existing attempts are never reshuffled, so refreshing cannot change a participant's sequence.
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
  v_attempt public.attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE id = p_participant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Participant not found.'); END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_participant.quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF v_quiz.status <> 'LIVE' THEN RETURN jsonb_build_object('ok', false, 'error', 'The quiz has not started yet.'); END IF;
  IF NOT v_participant.approved THEN RETURN jsonb_build_object('ok', false, 'error', 'You have not been approved to take this quiz.'); END IF;
  IF v_participant.rejected THEN RETURN jsonb_build_object('ok', false, 'error', 'Your registration was rejected.'); END IF;

  SELECT * INTO v_existing FROM public.attempts WHERE participant_id = p_participant_id;
  IF FOUND THEN
    IF v_existing.submitted_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this quiz.', 'submitted', true);
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', q.id, 'text', q.text, 'option_a', q.option_a, 'option_b', q.option_b,
      'option_c', q.option_c, 'option_d', q.option_d, 'marks', q.marks, 'position', ord.position
    ) ORDER BY ord.position), '[]'::jsonb)
    INTO v_questions
    FROM jsonb_array_elements_text(v_existing.question_order) WITH ORDINALITY AS ord(id, position)
    JOIN public.questions q ON q.id::text = ord.id;

    RETURN jsonb_build_object('ok', true,
      'attempt', jsonb_build_object('id', v_existing.id, 'current_index', v_existing.current_index, 'answered_count', v_existing.answered_count, 'started_at', v_existing.started_at, 'submitted_at', v_existing.submitted_at),
      'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions),
      'questions', v_questions, 'question_order', v_existing.question_order);
  END IF;

  SELECT COALESCE(jsonb_agg(q.id::text ORDER BY random()), '[]'::jsonb)
  INTO v_order FROM public.questions q WHERE q.quiz_id = v_quiz.id;
  IF jsonb_array_length(v_order) = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'No questions have been added to this quiz yet.'); END IF;

  INSERT INTO public.attempts (quiz_id, participant_id, question_order, started_at, last_seen_at)
  VALUES (v_quiz.id, p_participant_id, v_order, now(), now()) RETURNING * INTO v_attempt;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'text', q.text, 'option_a', q.option_a, 'option_b', q.option_b,
    'option_c', q.option_c, 'option_d', q.option_d, 'marks', q.marks, 'position', ord.position
  ) ORDER BY ord.position), '[]'::jsonb)
  INTO v_questions
  FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS ord(id, position)
  JOIN public.questions q ON q.id::text = ord.id;

  RETURN jsonb_build_object('ok', true,
    'attempt', jsonb_build_object('id', v_attempt.id, 'current_index', 0, 'answered_count', 0, 'started_at', v_attempt.started_at, 'submitted_at', null),
    'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes, 'status', v_quiz.status, 'num_questions', v_quiz.num_questions),
    'questions', v_questions, 'question_order', v_order);
END;
$$;
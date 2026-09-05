-- Fix start_quiz: pgcrypto is installed in the `extensions` schema, but the function
-- set search_path = public, so gen_random_bytes() was not found.
-- Recreate with search_path including `extensions` and schema-qualify the call.

CREATE OR REPLACE FUNCTION public.start_quiz(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_code text;
  v_attempts int := 0;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.'); END IF;
  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  -- Generate unique code
  LOOP
    v_code := 'QUIZ-' || upper(substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 5));
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      v_code := 'QUIZ-' || upper(substr(md5(random()::text), 1, 5));
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quizzes WHERE code = v_code AND id <> p_quiz_id);
  END LOOP;

  UPDATE public.quizzes SET code = v_code, status = 'LIVE' WHERE id = p_quiz_id;

  RETURN jsonb_build_object('ok', true, 'code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_quiz(uuid) TO authenticated;

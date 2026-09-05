/*
# Fix get_results: nested aggregate error

## Problem
The `get_results` function used `sum(e.marks_awarded)` inside `jsonb_agg()`,
both of which are aggregate functions. PostgreSQL does not allow nesting
aggregate functions, causing the error "aggregate function calls cannot be
nested" whenever the Results tab is opened.

## Fix
Rewrote the query to use a CTE that pre-computes per-participant sums
(marks obtained, total possible marks for unanswered questions) before
passing them into `jsonb_agg`. This eliminates the nested aggregate.

## No schema changes
No tables, columns, or policies are modified — only the function definition.
*/

CREATE OR REPLACE FUNCTION public.get_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.quizzes%ROWTYPE;
  v_results jsonb;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quiz not found.');
  END IF;
  IF NOT public.is_admin() OR v_quiz.created_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  WITH participant_scores AS (
    SELECT
      p.id AS participant_id,
      p.full_name,
      p.email,
      p.phone,
      p.register_number,
      COALESCE(p.department, '') AS department,
      a.id AS attempt_id,
      a.submitted_at,
      a.end_reason,
      a.started_at,
      COALESCE(sum(e.marks_awarded), 0) AS marks_obtained,
      (
        SELECT COALESCE(sum(q.marks), 0)
        FROM public.questions q
        WHERE q.quiz_id = v_quiz.id
        AND NOT EXISTS (
          SELECT 1 FROM public.responses r2
          JOIN public.evaluations e2 ON e2.response_id = r2.id
          WHERE r2.attempt_id = a.id AND r2.question_id = q.id
        )
      ) AS unanswered_marks,
      (
        SELECT COALESCE(sum(qq.marks), 0)
        FROM public.questions qq
        WHERE qq.quiz_id = v_quiz.id
      ) AS quiz_total_marks
    FROM public.participants p
    JOIN public.attempts a ON a.participant_id = p.id AND a.submitted_at IS NOT NULL
    LEFT JOIN public.responses r ON r.attempt_id = a.id
    LEFT JOIN public.evaluations e ON e.response_id = r.id
    WHERE p.quiz_id = p_quiz_id
    GROUP BY p.id, p.full_name, p.email, p.phone, p.register_number, p.department,
             a.id, a.submitted_at, a.end_reason, a.started_at
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'participant_id', ps.participant_id,
    'full_name', ps.full_name,
    'email', ps.email,
    'phone', ps.phone,
    'register_number', ps.register_number,
    'department', ps.department,
    'quiz_title', v_quiz.title,
    'total_marks', ps.marks_obtained + ps.unanswered_marks,
    'marks_obtained', ps.marks_obtained,
    'percentage', CASE
      WHEN ps.quiz_total_marks = 0 THEN 0
      ELSE ROUND(100.0 * ps.marks_obtained / ps.quiz_total_marks, 2)
    END,
    'submitted_at', ps.submitted_at,
    'end_reason', ps.end_reason,
    'time_taken_seconds', EXTRACT(EPOCH FROM (ps.submitted_at - ps.started_at))::int
  ) ORDER BY ps.full_name), '[]'::jsonb)
  INTO v_results
  FROM participant_scores ps;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$$;
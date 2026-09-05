/*
# Remove ambiguous quiz-start function overload

1. Purpose
- Remove the obsolete one-argument `public.start_quiz(uuid)` function.
- Keep the current `public.start_quiz(uuid, text)` function used by the admin dashboard.

2. Why this is needed
- Supabase RPC resolution sees both signatures when the dashboard starts a quiz.
- The two candidates have overlapping parameter behavior because the current function's device-mode parameter has a default value.
- Removing the obsolete overload makes the RPC call deterministic without changing quiz data.

3. Data safety
- No tables, rows, columns, or user data are deleted or modified.
- Only an unused database function overload is removed.

4. Security
- The retained function remains the existing admin-only SECURITY DEFINER function.
- Its existing authenticated execution grant and ownership checks remain unchanged.
*/

DROP FUNCTION IF EXISTS public.start_quiz(uuid);

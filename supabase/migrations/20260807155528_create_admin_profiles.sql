/*
# Create admin_profiles table

1. Purpose
- Stores metadata that marks a Supabase auth user as an admin of the quiz system.
- Supabase auth.users holds credentials (email/password); this table holds the
  admin role flag and is the source of truth for "is this user an admin?".

2. New Tables
- `admin_profiles`
  - `id` (uuid, primary key) — matches auth.users.id
  - `email` (text, not null) — denormalized for convenience reads
  - `full_name` (text, nullable) — display name
  - `created_at` (timestamptz, default now())

3. Security
- Enable RLS on `admin_profiles`.
- A user can read only their own admin profile row (SELECT, auth.uid() = id).
- A user can insert only their own row (INSERT, WITH CHECK auth.uid() = id).
- No UPDATE / DELETE via the anon/authenticated client — admin profile management
  is done through the service role / SQL, not the browser. This prevents a
  participant from elevating themselves to admin.
- Note: this table does NOT grant admin privileges by itself. The frontend
  checks for a matching row to decide whether to show admin routes; backend
  enforcement for quiz mutations is added in later phases via RLS / edge
  functions keyed on this table.
*/

CREATE TABLE IF NOT EXISTS admin_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_own_profile" ON admin_profiles;
CREATE POLICY "admin_read_own_profile"
  ON admin_profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "admin_insert_own_profile" ON admin_profiles;
CREATE POLICY "admin_insert_own_profile"
  ON admin_profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

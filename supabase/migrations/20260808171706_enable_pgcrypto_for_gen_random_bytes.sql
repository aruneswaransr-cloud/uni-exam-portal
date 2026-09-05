-- Enable pgcrypto so gen_random_bytes() is available (used by start_quiz to generate quiz codes)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

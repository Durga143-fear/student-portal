# Momentum Calendar

A Supabase-powered student habit tracker calendar with Google sign-in, protected app access, streak analytics, templates, completion history, and JSON backup tools.

## Stack

- Pure HTML, CSS, and JavaScript
- Vite production build
- Supabase Auth with Google OAuth
- Supabase tables for habits and daily logs
- Vercel-ready static deployment

## Required Environment Variables

Create `.env.local` for local development:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

The same variables must be configured in Vercel for Production, Preview, and Development environments.

<<<<<<< HEAD
Never use a `service_role` key in this frontend app.
=======
The app is a frontend-only static site configured for Supabase Auth. Signup and login require Supabase credentials in `auth-config.js`.
>>>>>>> 4a0bba7be0b971d62af01a70d4b1a5fd1b52f468

## Supabase Tables

The app expects these existing tables:

```sql
habits (
  id uuid primary key,
  user_id uuid,
  title text,
  color text,
  created_at timestamp
);

habit_logs (
  id uuid primary key,
  habit_id uuid,
  user_id uuid,
  completed boolean,
  date date
);
```

All frontend queries are scoped with `user_id = auth.user.id`. RLS policies should enforce the same boundary.

Because the current `habits` table does not include a separate icon column, the app stores the selected emoji at the start of `title` and parses it back into the existing UI.

<<<<<<< HEAD
## Local Development
=======
After this, every student can create an account with their own email and password. The `students` table uses row-level security, so signed-in students only access their own profile.

## Students Table

The table setup lives in `supabase-schema.sql`.

It creates:

- `public.students`
- the columns `id`, `email`, `full_name`, and `created_at`
- private per-user row-level security policies
- an auth trigger that creates a student profile when a new user signs up

## Deploy Frontend

This project is static, so it can be deployed to Netlify, Vercel, Firebase Hosting, or GitHub Pages.

### Netlify

Upload this folder or connect it to a GitHub repo. The included `netlify.toml` publishes the current folder.

### Vercel

Import the folder or GitHub repo and use these settings:

- Framework Preset: Other
- Build Command: leave blank
- Output Directory: `.`

The included `vercel.json` also sets `buildCommand` to `null` and `outputDirectory` to `.` so Vercel treats this as a static frontend and does not invoke a Node server or serverless function.

### Firebase Hosting
>>>>>>> 4a0bba7be0b971d62af01a70d4b1a5fd1b52f468

```bash
npm install
npm run dev
```

Open `http://localhost:5173` or `http://127.0.0.1:5173`, and use that same origin for the matching Supabase redirect URL. PKCE stores a verifier on the origin that starts login, so `localhost` and `127.0.0.1` should not be mixed within one OAuth attempt.

## Production Build

```bash
npm run build
npm run preview
```

## Vercel Deployment After Git Push

1. Push the repository to GitHub.
2. Import the repository in Vercel.
3. Set Framework Preset to `Vite`.
4. Confirm Build Command is `npm run build`.
5. Confirm Output Directory is `dist`.
6. Add environment variables in Vercel Project Settings:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
7. In Supabase Authentication settings, add these redirect URLs:
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
   - your Vercel preview URL
   - your Vercel production URL
8. Deploy from Vercel.
9. Test Google sign-in, page refresh, habit creation, and completion toggles on the deployed URL.

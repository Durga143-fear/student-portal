# Student Connect Portal

Static student signup and login website with Supabase Auth support.

## Local Preview

```bash
npx serve . --listen 5180
```

Open `http://localhost:5180`.

The app is a frontend-only static site configured for Supabase Auth. Signup and login require Supabase credentials in `auth-config.js`.

## Enable Supabase Auth

The current project URL is already set in `auth-config.js`:

```js
export const authConfig = {
  supabaseUrl: "https://bqwktztcdudejgelwvew.supabase.co",
  supabasePublishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

In Supabase:

1. Open Authentication, then Providers.
2. Enable the Email provider.
3. Open SQL Editor.
4. Paste and run the contents of `supabase-schema.sql`.
5. Add your deployed website URL to Authentication URL Configuration.

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

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

When Firebase asks for the public directory, use `.`.

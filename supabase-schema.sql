create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  full_name text,
  created_at timestamp default now()
);

alter table public.students enable row level security;

drop policy if exists "Students can read own profile" on public.students;
drop policy if exists "Students can create own profile" on public.students;
drop policy if exists "Students can update own profile" on public.students;

create policy "Students can read own profile"
on public.students
for select
to authenticated
using (auth.uid() = id);

create policy "Students can create own profile"
on public.students
for insert
to authenticated
with check (auth.uid() = id);

create policy "Students can update own profile"
on public.students
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.handle_new_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.students (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'Student')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_student();

create table if not exists public.students (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  roll_number text,
  course text not null default 'B.Sc Computer Science',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_students_updated_at on public.students;

create trigger set_students_updated_at
before update on public.students
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.students (id, email, full_name, roll_number, course)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', 'Student'),
    coalesce(new.raw_user_meta_data->>'roll_number', 'Not added'),
    coalesce(new.raw_user_meta_data->>'course', 'B.Sc Computer Science')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    roll_number = excluded.roll_number,
    course = excluded.course,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_student();

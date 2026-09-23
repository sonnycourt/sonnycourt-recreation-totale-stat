-- Additive, rerunnable. No webinar registration and no outbound messaging.
begin;
create table if not exists public.mc2_challenge_contacts (
  email text primary key,
  first_name text not null,
  telephone text not null,
  phone_country text not null,
  source_path text not null default '/mc2/',
  traffic_source text,
  optin_funnel_id text,
  created_at timestamptz not null default now(),
  constraint mc2_challenge_contacts_email_length check (length(email) between 3 and 320)
);
alter table public.mc2_challenge_contacts enable row level security;
revoke all on public.mc2_challenge_contacts from anon, authenticated;
grant select, insert on public.mc2_challenge_contacts to service_role;
comment on table public.mc2_challenge_contacts is 'Contacts redirected from MC2 to Challenge Transformation. Supabase only; no MailerLite, webinar reminders or reopening promise.';
commit;

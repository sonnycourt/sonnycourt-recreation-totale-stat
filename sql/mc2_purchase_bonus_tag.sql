begin;

alter table public.mc2_registrations
  add column if not exists purchase_bonus_tag text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mc2_registrations_purchase_bonus_tag_check'
      and conrelid = 'public.mc2_registrations'::regclass
  ) then
    alter table public.mc2_registrations
      add constraint mc2_registrations_purchase_bonus_tag_check
      check (
        purchase_bonus_tag is null
        or purchase_bonus_tag in (
          'avec_consultation_sonny',
          'sans_consultation_sonny'
        )
      ) not valid;
  end if;
end
$$;

alter table public.mc2_registrations
  validate constraint mc2_registrations_purchase_bonus_tag_check;

create index if not exists idx_mc2_registrations_purchase_bonus_tag
  on public.mc2_registrations (purchase_bonus_tag, purchased_at desc)
  where purchased_at is not null;

comment on column public.mc2_registrations.purchase_bonus_tag is
  'Statut figé lors du premier achat MC2 : avec_consultation_sonny avant CTA + 24 h, sinon sans_consultation_sonny.';

commit;

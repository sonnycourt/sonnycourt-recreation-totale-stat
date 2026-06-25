-- Oracle ES2 — base de réponses passées pour l'assistant de rédaction /oracle-es2.
-- Une seule exécution dans Supabase SQL Editor (projet SonnyCourt Main Site).
-- Accès uniquement via Netlify Functions + service role (RLS active, aucune policy).

-- 1. Extension pgvector (embeddings OpenAI text-embedding-3-small = 1536 dimensions)
create extension if not exists vector;

-- 2. Table des paires question / réponse (+ raisonnement optionnel)
create table if not exists public.oracle_es2_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  reponse text not null,
  raisonnement text,                 -- optionnel : le "pourquoi" de l'angle
  embedding vector(1536),            -- embedding de la QUESTION
  created_at timestamptz default now()
);

comment on table public.oracle_es2_entries is
  'Réponses passées (style perso) pour l''assistant de rédaction /oracle-es2. Embedding = question. Accès service role uniquement.';

-- 3. RLS active, aucune policy : anon/authenticated bloqués, la service role Netlify bypass RLS.
alter table public.oracle_es2_entries enable row level security;

-- 4. Recherche sémantique par similarité cosinus.
--    Pas d'index ivfflat volontairement : à faible volume (~10 à quelques centaines de lignes)
--    un scan séquentiel est EXACT et rapide. Ajouter un index ivfflat plus tard quand la base grossit :
--      create index on public.oracle_es2_entries using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create or replace function public.match_oracle_es2(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id uuid,
  question text,
  reponse text,
  raisonnement text,
  similarity float
)
language sql
stable
as $$
  select
    e.id,
    e.question,
    e.reponse,
    e.raisonnement,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.oracle_es2_entries e
  where e.embedding is not null
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

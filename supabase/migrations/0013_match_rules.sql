-- Migration 0013_match_rules
-- RPC function for rule retrieval by pgvector cosine similarity

create or replace function match_rules(
  query_embedding vector(768),
  match_domain text,
  match_count int default 5
)
returns setof rules
language sql
security definer
as $$
  select *
  from rules
  where domain = match_domain
  order by embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function match_rules(vector(768), text, int) to authenticated, service_role;
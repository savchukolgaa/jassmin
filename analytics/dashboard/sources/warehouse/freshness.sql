-- When the last nightly copy of the shop's data finished (#183): every page shows it.
select max(finished_at) as extracted_at from meta.extract_runs

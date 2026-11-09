{#- Casts for the raw layer. #131 loads every raw column as text, so anomalies survive; the app's own
    tables (the `prod` target) are typed. Each macro goes through `::text` first, so it works on both. -#}

{#- The trimmed value, `null` when empty. -#}
{% macro clean_text(column) -%}
  nullif(trim(({{ column }})::text), '')
{%- endmacro %}

{% macro to_int(column) -%}
  ({{ clean_text(column) }})::integer
{%- endmacro %}

{#- Money: UAH with kopiyky. -#}
{% macro to_money(column) -%}
  ({{ clean_text(column) }})::numeric(12, 2)
{%- endmacro %}

{% macro to_bool(column) -%}
  ({{ clean_text(column) }})::boolean
{%- endmacro %}

{% macro to_uuid(column) -%}
  ({{ clean_text(column) }})::uuid
{%- endmacro %}

{% macro to_jsonb(column) -%}
  ({{ clean_text(column) }})::jsonb
{%- endmacro %}

{#- A Postgres array literal (`{a,b}`) or the app's `text[]`. -#}
{% macro to_text_array(column) -%}
  coalesce(({{ clean_text(column) }})::text[], '{}'::text[])
{%- endmacro %}

{#- True when a timestamp carries no UTC offset (#131's "timezone-naive UTC" anomaly). -#}
{% macro is_naive_timestamp(column) -%}
  ({{ clean_text(column) }} !~ '\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*([zZ]|[+-]\d{2}(:?\d{2})?)$')
{%- endmacro %}

{#- A timestamp as `timestamptz`. One with an offset keeps it; a naive one is UTC (#131 writes naive
    timestamps in UTC), never the session's time zone. -#}
{% macro to_utc(column) -%}
  case
    when {{ clean_text(column) }} is null then null
    when {{ is_naive_timestamp(column) }}
      then ({{ clean_text(column) }})::timestamp at time zone 'UTC'
    else ({{ clean_text(column) }})::timestamptz
  end
{%- endmacro %}

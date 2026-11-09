{#- The Kyiv calendar date of a `timestamptz` (every date in the warehouse is a Kyiv date). -#}
{% macro kyiv_date(column) -%}
  (({{ column }}) at time zone '{{ var("timezone") }}')::date
{%- endmacro %}

{#- Days between two `timestamptz`s, with a fraction (e.g. 1.50 for 36 hours). -#}
{% macro days_between(start_column, end_column) -%}
  round((extract(epoch from (({{ end_column }}) - ({{ start_column }}))) / 86400.0)::numeric, 2)
{%- endmacro %}

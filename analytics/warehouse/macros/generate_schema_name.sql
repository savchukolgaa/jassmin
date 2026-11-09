{#- Build each layer in exactly the schema it names (`staging`, `intermediate`, `marts`), not dbt's
    default `<target schema>_<custom schema>`, so BI and ML read stable names. -#}
{% macro generate_schema_name(custom_schema_name, node) -%}
  {%- if custom_schema_name is none -%}
    {{ target.schema }}
  {%- else -%}
    {{ custom_schema_name | trim }}
  {%- endif -%}
{%- endmacro %}

{#- The surrogate key of a customer: a registered user by id, a guest by their normalised email, so
    a guest's repeat orders are one customer. Neither the id nor the email reaches the marts. -#}
{% macro customer_key(user_id_column, email_column="null") -%}
  md5(
    case
      when ({{ user_id_column }}) is not null then 'u:' || ({{ user_id_column }})::text
      else 'g:' || ({{ email_column }})
    end
  )
{%- endmacro %}

{#- The surrogate key of a product; `-1` is the "unknown product" member (a deleted product). -#}
{% macro product_key(product_id_column) -%}
  coalesce(({{ product_id_column }}), -1)
{%- endmacro %}

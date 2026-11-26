<!--
  "Дані на …": when the nightly copy of the shop's data finished (#183), on every page, and a warning
  when it is older than 36 hours (the nightly job failed, so the site still shows an earlier build).
  `data` is the `freshness` query: one row with `extracted_at`.
-->
<script>
  export let data;

  const STALE_HOURS = 36;
  const format = new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Kyiv",
  });

  $: rows = data ? Array.from(data) : [];
  $: raw = rows.length > 0 ? rows[0].extracted_at : null;
  $: at = raw ? new Date(raw) : null;
  $: stale = !at || Date.now() - at.getTime() > STALE_HOURS * 3600 * 1000;
</script>

<p class="data-date">
  Дані на {at ? format.format(at) : "—"} (Київ). Оновлюються щоночі; сьогоднішні замовлення
  з'являться завтра.
</p>
{#if stale}
  <p class="data-date-stale" role="status">
    Нічне оновлення не вдалося або ще не відбулося: дані старші за {STALE_HOURS} годин. Сайт
    показує останню вдалу збірку.
  </p>
{/if}

<style>
  .data-date {
    font-size: 0.875rem;
    opacity: 0.75;
    margin: 0 0 1rem;
  }
  .data-date-stale {
    border: 1px solid #b45309;
    background: #fef3c7;
    color: #78350f;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    margin: 0 0 1rem;
  }
</style>

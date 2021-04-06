<script lang="ts">
  type Centres = Record<string, number>;

  export let ariaLabelledBy: string;
  export let centres: Centres = {};
  export let lastUpdated: Date;
  // Object.entries polyfill
  const orderedCentres = Object.keys(centres).map((centre) => [
    centre,
    centres[centre],
  ]);
</script>

<table aria-labelledby={ariaLabelledBy}>
  <thead>
    <tr>
      <th>Impfzentrum</th>
      <th>Freie Termine</th>
    </tr></thead
  >
  <tbody>
    {#each orderedCentres as [centre, dates]}
      <tr
        ><th class="centre" scope="row">{centre}</th><td class="free-dates"
          >{dates}</td
        ></tr
      >
    {/each}
  </tbody>
</table>

<p>
  Zuletzt aktualisiert: <time datetime={lastUpdated.toISOString()}
    >{lastUpdated.toLocaleString()}</time
  >
</p>

<p>
  Daten basierend auf <a
    href="https://www.countee.ch/app/de/counter/impfee/_iz_sachsen"
    >https://www.countee.ch/app/de/counter/impfee/_iz_sachsen</a
  >
</p>

<style>
  .centre {
    text-align: left;
  }

  .free-dates {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
</style>

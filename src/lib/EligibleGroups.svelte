<script lang="ts">
  interface EligibleGroup {
    label: string;
  }
  type EligibleGroups = Record<string, EligibleGroup>;

  export let groups: EligibleGroups = {};
  export let lastUpdated: Date;
  // Object.values polyfill
  const orderedGroups = Object.keys(groups).map((id) => groups[id]);
</script>

<p>
  Zuletzt aktualisiert: <time datetime={lastUpdated.toISOString()}
    >{lastUpdated.toLocaleString()}</time
  >
</p>
<ul>
  {#each orderedGroups as group}
    <li>{group.label}</li>
  {/each}
</ul>

<style>
</style>

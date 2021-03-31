<script lang="ts">
  interface EligibleGroup {
    label: string;
  }
  type EligibleGroups = Record<string, EligibleGroup>;

  export let groups: EligibleGroups = {};
  // Object.values polyfill
  const orderedGroups = Object.keys(groups).map((id) => groups[id]);
</script>

<ul>
  {#each orderedGroups as group}
    <li>{group.label}</li>
  {/each}
</ul>

<style>
</style>

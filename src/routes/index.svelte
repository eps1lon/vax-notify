<script context="module" lang="ts">
  export const load: import("@sveltejs/kit").Load = async function load({
    fetch,
  }) {
    const url = `/eligibleGroups.json`;
    const response = await fetch(url);

    // @ts-expect-error https://github.com/sveltejs/kit/issues/691
    if (response.ok) {
      return {
        props: {
          // @ts-expect-error https://github.com/sveltejs/kit/issues/691
          groups: await response.json(),
        },
      };
    }

    return {
      status: response.status,
      error: new Error(`Unable to load eligible groups.`),
    };
  };
</script>

<script lang="ts">
  import EligibleGroups from "$lib/EligibleGroups.svelte";

  interface EligibleGroup {
    label: string;
  }

  export let groups: Record<string, EligibleGroup>;
</script>

<svelte:head>
  <title>Covid-19 Impftermin Benachrichtigungsportal</title>
</svelte:head>

<main>
  <h1>Covid-19 Impftermin Benachrichtigungsportal</h1>

  <h2>Berechtigte Gruppen</h2>
  <EligibleGroups {groups} />
</main>

<style>
  main {
    padding: 1em;
  }

  h1 {
    color: #ff3e00;
    text-transform: uppercase;
    font-size: 4rem;
    font-weight: 100;
    line-height: 1.1;
  }
</style>

<script context="module" lang="ts">
  export const load: import("@sveltejs/kit").Load = async function load({
    fetch,
  }) {
    const url = `/eligibleGroups.json`;
    const response = await fetch(url);

    // @ts-expect-error https://github.com/sveltejs/kit/issues/691
    if (response.ok) {
      // @ts-expect-error https://github.com/sveltejs/kit/issues/691
      const { groups, lastUpdated: lastUpdatedString } = await response.json();

      return {
        props: {
          groups,
          lastUpdated: new Date(lastUpdatedString),
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
  export let lastUpdated: Date;
</script>

<svelte:head>
  <title>Covid-19 Impftermin Benachrichtigungsportal</title>
</svelte:head>

<main>
  <h1>Covid-19 Impftermin Benachrichtigungsportal</h1>

  <p>
    Daten basierend auf <a href="https://sachsen.impfterminvergabe.de/"
      >https://sachsen.impfterminvergabe.de/</a
    >.
  </p>

  <h2>Berechtigte Gruppen</h2>
  <EligibleGroups {groups} {lastUpdated} />
</main>

<footer>
  <h2>Weiterführende Links</h2>
  <nav>
    <ul>
      <li>
        <a href="https://sachsen.impfterminvergabe.de/"
          >Serviceportal zur Impfung gegen das Coronavirus in Sachsen</a
        >
      </li>
      <li>
        <a href="https://www.countee.ch/app/de/counter/impfee/_iz_sachsen"
          >Freie Impftermine in Sachsen</a
        >
      </li>
    </ul>
  </nav>

  <h2>Impressum</h2>
  <address>
    <dl>
      <dt>Name</dt>
      <dd>Sebastian Silbermann</dd>
      <dt>Mail</dt>
      <dd>
        <a href="mailto:silbermann.sebastian@gmail.com"
          >silbermann.sebastian@gmail.com</a
        >
      </dd>
      <dt>GitHub</dt>
      <dd><a href="https://github.com/eps1lon">@eps1lon</a></dd>
      <dt>Website</dt>
      <dd><a href="https://solverfox.dev">solverfox.dev</a></dd>
    </dl>
  </address>
</footer>

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

  footer {
    border-top: 1px solid black;
    font-size: 0.9em;
  }
</style>

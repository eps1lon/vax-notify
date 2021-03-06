<script context="module" lang="ts">
  export const load: import("@sveltejs/kit").Load = async function load({
    fetch,
  }) {
    async function loadFreeDates() {
      const url = `https://vax-notify.s3.eu-central-1.amazonaws.com/data/freeDates.json`;
      const response = await fetch(url);

      // @ts-expect-error https://github.com/sveltejs/kit/issues/691
      if (response.ok) {
        // @ts-expect-error https://github.com/sveltejs/kit/issues/691
        const { dates, lastUpdated: lastUpdatedString } = await response.json();

        return {
          dates,
          datesLastUpdated: new Date(lastUpdatedString),
        };
      }
    }

    try {
      const [freeDatesProps] = await Promise.all([loadFreeDates()]);

      return {
        props: {
          ...freeDatesProps,
        },
      };
    } catch (error) {
      return {
        status: 500,
        error: new Error(`Unable to load eligible groups.`),
      };
    }
  };
</script>

<script lang="ts">
  import { dev } from "$app/env";
  import { onMount } from "svelte";
  import FreeDates from "$lib/FreeDates.svelte";

  export let dates: Record<string, number>;
  export let datesLastUpdated: Date;
  async function revalidateDates() {
    if (dev) {
      console.log("revalidating free dates");
    }

    fetch(
      "https://vax-notify.s3.eu-central-1.amazonaws.com/data/freeDates.json"
    ).then(async (response) => {
      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
      const { lastUpdated, dates: currentDates } = await response.json();

      datesLastUpdated = new Date(lastUpdated);
      dates = currentDates;
    });
  }

  function revalidatePeriodically(timeoutMS: number): void {
    setTimeout(async () => {
      try {
        await revalidateDates();
      } finally {
        revalidatePeriodically(timeoutMS);
      }
    }, timeoutMS);
  }

  onMount(() => {
    revalidatePeriodically(1000 * 60 * 5);
    revalidateDates();
  });
</script>

<svelte:head>
  <title>Covid-19 Impftermin Benachrichtigungsportal</title>
</svelte:head>

<svelte:window on:focus={revalidateDates} />

<main>
  <h1>Covid-19 Impftermin Benachrichtigungsportal</h1>

  <p>
    Jetzt <a href="https://sachsen.impfterminvergabe.de/">Termin buchen</a>.
  </p>

  <h2 id="free-dates-heading">Freie Termine</h2>
  <FreeDates
    ariaLabelledBy="free-dates-heading"
    centres={dates}
    lastUpdated={datesLastUpdated}
  />
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

  <h2>Quelltext</h2>
  <p>
    Quelltext veröffentlich auf <a href="https://github.com/eps1lon/vax-notify">
      github:eps1lon/vax-notify</a
    >
    unter <a href="https://opensource.org/licenses/MIT">MIT Lizenz</a>.
  </p>

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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['suites/**/*.e2e.test.ts'],

    // Every assertion in this suite waits on real infrastructure: Grail needs
    // time to make freshly ingested spans queryable, and the CLI spawns a real
    // subprocess that talks to a judge provider. The Go suite it mirrors polls
    // spans for up to 8 minutes; 3 minutes is enough here because we consume
    // spans the upstream nightly seeded hours ago rather than waiting on an
    // app we just started.
    testTimeout: 180_000,

    // One DQL call can legitimately take 180s: a 60s HTTP timeout
    // (E2E_DT_HTTP_TIMEOUT) against a query that went async, which is expected
    // rather than exceptional — the client asks the tenant for a 25s server-side
    // budget, so a 24h span scan comes back RUNNING by design and is then polled
    // up to POLL_DEADLINE_FACTOR times the HTTP timeout.
    //
    // The hooks that matter do up to two of those in sequence, and 60s here meant
    // a merely slow tenant reported "Hook timed out in 60000ms" instead of the
    // seedingHint() message written precisely to explain that situation.
    hookTimeout: 420_000,

    // Run strictly sequentially. Tests share one tenant and one judge quota, and
    // each spawns CLI subprocesses — running them in parallel interleaves captured
    // output and invites provider rate limits, both of which show up as flake
    // rather than as the real signal.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },

    // The two settings above only serialise *files*. Within a file, serialism
    // held by convention alone — nothing used `.concurrent`, while
    // maxConcurrency sat at its default of 5. The design doc calls sequential
    // execution a deliberate property, so pin it rather than leaving a stray
    // `it.concurrent` able to reintroduce parallelism silently.
    //
    // These two are load-bearing for *correctness*, not just for tenant rate
    // limits: cli.e2e.test.ts and harness.e2e.test.ts mutate the runner's own
    // process.env and restore it in a finally block, which is only safe while
    // nothing else runs at the same time. Relaxing them means rewriting those.
    maxConcurrency: 1,
    sequence: { concurrent: false },

    // Surface which cases skipped and why. A silently skipped E2E suite that
    // reports green is the failure mode this suite exists to avoid.
    reporters: ['verbose'],
  },
});

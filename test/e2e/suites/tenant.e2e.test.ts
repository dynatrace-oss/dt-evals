/**
 * Tenant reachability — the design doc's "Credentials — good: valid ones connect".
 *
 * The cheapest possible real check, and the one every other suite depends on: if
 * this is red, a failure anywhere else says nothing about dt-evals. It also
 * proves the harness itself works (env resolution → DQL client → tenant).
 */

import { describe, expect, it } from 'vitest';
import { DynatraceClient } from '../src/dynatrace.js';
import { e2eEnabled, tenant } from '../src/env.js';

describe.skipIf(!e2eEnabled())('tenant reachability', () => {
  it('executes a DQL query against the configured tenant', async () => {
    const { appsEndpoint, apiToken } = tenant();
    const client = new DynatraceClient(appsEndpoint, apiToken);

    // `fetch logs | limit 1` is what the CLI's own connectivity probe uses
    // (dt-eval-cli/src/cli/commands/validate.ts:15), so a pass here means
    // `validate`'s connection check will pass for the same reason.
    const records = await client.execute('fetch logs, from:now() - 1h | limit 1');

    // Asserting "the query succeeded", not "the tenant has logs" — an idle
    // tenant legitimately returns zero records, and failing on that would make
    // this test about data volume rather than about credentials.
    expect(Array.isArray(records)).toBe(true);
  });

  it('rejects a bad token rather than silently returning nothing', async () => {
    const { appsEndpoint } = tenant();
    const client = new DynatraceClient(appsEndpoint, 'dt0c01.INVALID.INVALID');

    // The negative half of the same check. This matters more than it looks:
    // Grail answers a missing *scope* with SUCCEEDED-and-zero-records, so
    // "empty result" is not a reliable signal of an auth problem. A rejected
    // token must surface as a thrown error.
    await expect(client.execute('fetch logs | limit 1')).rejects.toThrow();
  });
});

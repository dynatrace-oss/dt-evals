/** Tenant reachability — the cheapest real check, and the one every other suite depends on. */

import { describe, expect, it } from 'vitest';
import { DynatraceClient, PermanentQueryError } from '../src/dynatrace.js';
import { e2eEnabled, tenant } from '../src/env.js';

describe.skipIf(!e2eEnabled())('tenant reachability', () => {
  it('executes a DQL query against the configured tenant', async () => {
    const { appsEndpoint, apiToken } = await tenant();
    const client = new DynatraceClient(appsEndpoint, apiToken);

    // Not asserting on the records — an idle tenant legitimately returns
    // zero, and execute() always returns an array, so the test is that this
    // resolves rather than throws.
    await expect(
      client.execute('fetch logs, from:now() - 1h | limit 1'),
    ).resolves.toBeDefined();
  });

  it('rejects a bad token rather than silently returning nothing', async () => {
    const { appsEndpoint } = await tenant();
    const client = new DynatraceClient(appsEndpoint, 'dt0c01.INVALID.INVALID');

    // PermanentQueryError specifically — a bare toThrow() would also pass on a DNS failure or 500.
    await expect(client.execute('fetch logs | limit 1')).rejects.toThrow(PermanentQueryError);
  });
});

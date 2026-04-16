/**
 * Validate that bizevents for a dt-eval run landed in Dynatrace.
 * Usage: npx tsx .github/e2e/validate.ts <bearer_token> <env_url> <run_id>
 *
 * Polls until records appear or the timeout is reached — no fixed sleep needed.
 */

const [, , token, envUrl, runId] = process.argv;

if (!token || !envUrl || !runId) {
  console.error('Usage: validate.ts <api_token> <env_url> <run_id>');
  process.exit(1);
}

const BASE = envUrl.replace(/\/$/, '');
const PROPAGATION_TIMEOUT_MS = 2 * 60_000; // 2 min max wait for bizevent propagation
const RETRY_INTERVAL_MS = 5_000;

interface DqlResponse {
  state?: string;
  requestToken?: string;
  result?: { records: Record<string, unknown>[] };
}

async function dqlExecute(query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/platform/storage/query/v1/query:execute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, requestTimeoutMilliseconds: 30_000 }),
  });

  if (!res.ok) throw new Error(`DQL execute failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as DqlResponse;

  if (data.state === 'RUNNING' && data.requestToken) {
    return pollDql(data.requestToken);
  }
  return data.result?.records ?? [];
}

async function pollDql(requestToken: string): Promise<Record<string, unknown>[]> {
  const url = `${BASE}/platform/storage/query/v1/query:poll?requestToken=${encodeURIComponent(requestToken)}`;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`DQL poll failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as DqlResponse;
    if (data.state === 'SUCCEEDED') return data.result?.records ?? [];
    if (data.state === 'FAILED') throw new Error('DQL query failed on server');
  }
  throw new Error('DQL poll timed out');
}

async function waitForBizevents(query: string): Promise<Record<string, unknown>[]> {
  const deadline = Date.now() + PROPAGATION_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const records = await dqlExecute(query);
    if (records.length > 0) {
      console.log(`Found ${records.length} bizevent(s) after ${attempt} attempt(s)`);
      return records;
    }
    const remaining = Math.round((deadline - Date.now()) / 1000);
    console.log(`Attempt ${attempt}: no records yet, retrying in ${RETRY_INTERVAL_MS / 1000}s (${remaining}s remaining)...`);
    await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
  }
  throw new Error(`No bizevents found for runId=${runId} after ${PROPAGATION_TIMEOUT_MS / 1000}s`);
}

async function main() {
  const query = `
    fetch bizevents
    | filter event.type == "gen_ai.evaluation.result"
      and \`dt.eval.run_id\` == "${runId}"
    | fields \`dt.eval.run_id\`, \`gen_ai.evaluation.name\`, \`gen_ai.evaluation.score.value\`, \`gen_ai.provider.name\`, timestamp
    | sort timestamp desc
  `.trim();

  console.log(`Waiting for bizevents (runId=${runId}, timeout=${PROPAGATION_TIMEOUT_MS / 1000}s)...`);
  const records = await waitForBizevents(query);

  const required = ['gen_ai.evaluation.name', 'gen_ai.evaluation.score.value', 'dt.eval.run_id'];
  const now = Date.now();

  for (const r of records) {
    for (const field of required) {
      if (!(field in r)) {
        console.error(`FAIL: Missing field '${field}' in bizevent: ${JSON.stringify(r)}`);
        process.exit(1);
      }
    }
    const ts = r['timestamp'] as string | undefined;
    if (ts) {
      const ageMin = (now - new Date(ts).getTime()) / 60_000;
      if (ageMin > 15) {
        console.error(`FAIL: Bizevent is ${ageMin.toFixed(1)} min old (expected < 15): ${ts}`);
        process.exit(1);
      }
    }
  }

  console.log('All field and freshness checks passed.');
  console.log(`Sample record:\n${JSON.stringify(records[0], null, 2)}`);
}

main().catch(err => { console.error(err); process.exit(1); });

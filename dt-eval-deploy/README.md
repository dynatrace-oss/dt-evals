# dt-eval-deploy

Deployment resources for running `dt-eval` as a continuously scheduled serverless function.

## Overview

For on-demand or CI usage, no deployment is needed — run `dt-eval` directly. This folder is for teams that want continuous, scheduled evaluation without keeping a local process running.

The serverless runner is a lightweight TypeScript/Node.js wrapper around the same `dt-eval` CLI used locally. This keeps the runtime consistent: same code, same evaluators, same config — just triggered by a cloud scheduler instead of a terminal.

## Deployment options

### Serverless

Deploy to AWS Lambda, Google Cloud Run, or Azure Functions using the `deploy` command:

```bash
dt-eval deploy --provider aws      # AWS Lambda (Node.js runtime)
dt-eval deploy --provider gcp      # Google Cloud Run (Node.js container)
dt-eval deploy --provider azure    # Azure Functions (Node.js runtime)
dt-eval deploy --teardown          # Destroy resources
```

Each provider packages the CLI as a Node.js function and wires up the schedule configured via `dt-eval schedule set`.

### Docker

Run the eval runner in a container for self-hosted or Kubernetes-based deployments:

```bash
cd dt-eval-deploy
docker build -t dt-eval .
docker run --env-file .env dt-eval run --since 1h --sample 10
```

## Contents

- `src/` — TypeScript serverless entrypoint (Lambda handler + HTTP server)
- `Dockerfile` — container image for Cloud Run / Kubernetes deployments

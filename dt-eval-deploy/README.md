# dt-eval-deploy

Deployment resources for running `dt-eval` as a continuously scheduled serverless function.

## Overview

For on-demand or CI usage, no deployment is needed — run `dt-eval` directly. This folder is for teams that want continuous, scheduled evaluation without keeping a local process running.

## Deployment options

### Docker

`dt-eval-engine` provides a container image that wraps the CLI for scheduled execution.

```bash
cd dt-eval-deploy/dt-eval-engine
docker build -t dt-eval-engine .
docker run --env-file .env dt-eval-engine
```

### Serverless

Deploy to AWS Lambda, Google Cloud Run, or Azure Functions using the `deploy` command:

```bash
dt-eval deploy --provider aws      # AWS Lambda
dt-eval deploy --provider gcp      # Google Cloud Run
dt-eval deploy --provider azure    # Azure Functions
dt-eval deploy --teardown          # Destroy resources
```

See [eval.md](../eval.md) — Section 10 for full configuration reference.

## Contents

- `dt-eval-engine/` — Go-based container entrypoint for the eval runner

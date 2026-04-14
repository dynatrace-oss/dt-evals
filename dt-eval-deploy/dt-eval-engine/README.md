# dt-eval-engine

> Serverless LLM evaluation runtime for dt-evals.

The engine exposes an HTTP API that mirrors the `evaluate()` function from
`dt-eval-lib`, packaged as a deployable Go binary. Deploy it once with
`dt-eval deploy aws|gcp|azure` and then target the endpoint from your
evaluation pipelines instead of running evaluations locally.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/evaluate` | Run a single evaluation |
| `GET` | `/health` | Liveness probe |
| `GET` | `/metrics` | List available metric IDs |

## Deployment targets

| Target | How |
|---|---|
| AWS Lambda | `dt-eval deploy aws` — packages binary in Lambda container image |
| Google Cloud Run | Set `DT_EVAL_MODE=http`, `PORT=8080` |
| Azure Functions | Set `DT_EVAL_MODE=http`, `PORT=8080` |

## Local development

```bash
DT_EVAL_MODE=http PORT=8080 go run ./cmd/handler
```

## Build

```bash
go build ./...

# or via the root makefile:
make build-engine
```

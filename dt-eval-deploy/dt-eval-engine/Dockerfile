# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o handler ./cmd/handler

# ── Lambda runtime stage ──────────────────────────────────────────────────────
# Uses the AWS-provided Lambda base image for custom runtimes (al2023).
# For Cloud Run / Azure Functions, swap this for `FROM scratch` or
# `FROM gcr.io/distroless/static` and set DT_EVAL_MODE=http / PORT=8080.
FROM public.ecr.aws/lambda/provided:al2023

COPY --from=builder /app/handler ${LAMBDA_TASK_ROOT}/handler

CMD ["handler"]

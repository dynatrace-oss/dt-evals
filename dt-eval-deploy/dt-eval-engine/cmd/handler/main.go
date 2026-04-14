// Copyright 2024 Dynatrace LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package main is the entry point for dt-eval-engine.
//
// It starts as an AWS Lambda handler when deployed via `dt-eval deploy aws`.
// The same HTTP handler can also be run as a plain HTTP server for local
// development or when deployed to Cloud Run / Azure Functions.
//
// Deploy targets:
//   - AWS Lambda (Lambda Function URL, no API Gateway needed)
//   - Google Cloud Run  (set DT_EVAL_MODE=http, PORT=8080)
//   - Azure Functions   (set DT_EVAL_MODE=http, PORT=8080)
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/dynatrace-oss/dt-evals/packages/dt-eval-engine/internal/api"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	handler := api.NewHandler(logger)

	mode := os.Getenv("DT_EVAL_MODE")
	if mode == "http" {
		// Plain HTTP server — used for Cloud Run / Azure Functions / local dev
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		logger.Info("starting HTTP server", "port", port)
		if err := http.ListenAndServe(":"+port, handler); err != nil {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
		return
	}

	// Default: AWS Lambda
	logger.Info("starting Lambda handler")
	lambda.StartWithOptions(
		lambdaAdapter(handler),
		lambda.WithContext(context.Background()),
	)
}

// lambdaAdapter wraps a standard http.Handler for use with Lambda Function URLs.
//
// TODO: wire up github.com/awslabs/aws-lambda-go-api-proxy or equivalent.
func lambdaAdapter(h http.Handler) func(ctx context.Context, event map[string]any) (map[string]any, error) {
	return func(ctx context.Context, event map[string]any) (map[string]any, error) {
		// TODO: convert Lambda Function URL event → http.Request, invoke h, return response
		_ = h
		return map[string]any{"statusCode": 501, "body": "not implemented"}, nil
	}
}

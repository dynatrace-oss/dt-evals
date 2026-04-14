// Copyright 2024 Dynatrace LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0

// Package eval implements LLM-as-judge evaluation logic for dt-eval-engine.
//
// This is the Go equivalent of dt-eval-lib, implementing the same prompt
// catalog, scoring scales, and provider abstraction so the engine can run
// without a Node.js runtime.
//
// Design mirrors dt-eval-lib:
//
//	Evaluator.Evaluate(ctx, req) → EvalResult
//	  ├── resolve prompt from catalog
//	  ├── validate required fields
//	  ├── render prompt template ({{input}}, {{output}}, {{context}}, …)
//	  ├── call LLM provider (OpenAI / Anthropic)
//	  └── compute score (binary | continuous | likert)
package eval

import (
	"context"
	"log/slog"
)

// EvalInput holds the data fields for a single evaluation.
// Mirrors EvalInput in dt-eval-lib/src/engine/types.ts.
type EvalInput struct {
	Metric         string
	Input          string
	Output         string
	Context        *string
	ExpectedOutput *string
	Trajectory     *string
	Provider       string // "openai" | "anthropic"
	Model          *string
}

// EvalResult is the outcome of a single evaluation.
// Mirrors EvalResult in dt-eval-lib/src/engine/types.ts.
type EvalResult struct {
	Score struct {
		Value float64 // 0.0–1.0 (or 1–5 for likert)
		Label string  // "pass" | "fail"
	}
	Explanation struct {
		Summary   string
		Reasoning string
	}
}

// Evaluator runs LLM-as-judge evaluations.
type Evaluator struct {
	logger *slog.Logger
}

// NewEvaluator constructs an Evaluator.
func NewEvaluator(logger *slog.Logger) *Evaluator {
	return &Evaluator{logger: logger}
}

// Evaluate runs a single evaluation and returns the result.
//
// TODO: implement prompt catalog lookup, template rendering,
// provider calls (OpenAI / Anthropic), and score computation.
func (e *Evaluator) Evaluate(_ context.Context, input EvalInput) (EvalResult, error) {
	e.logger.Info("evaluating", "metric", input.Metric, "provider", input.Provider)
	// TODO: implement
	return EvalResult{}, nil
}

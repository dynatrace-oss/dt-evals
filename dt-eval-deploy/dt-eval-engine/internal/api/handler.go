// Copyright 2024 Dynatrace LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0

// Package api implements the HTTP surface of dt-eval-engine.
//
// Endpoints:
//
//	POST /evaluate   — run a single evaluation, return score + explanation
//	GET  /health     — liveness probe
//	GET  /metrics    — list available built-in metric IDs
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/dynatrace-oss/dt-evals/packages/dt-eval-engine/internal/eval"
)

// Handler is the root HTTP handler for dt-eval-engine.
type Handler struct {
	logger    *slog.Logger
	evaluator *eval.Evaluator
}

// NewHandler constructs a Handler and registers all routes.
func NewHandler(logger *slog.Logger) http.Handler {
	h := &Handler{
		logger:    logger,
		evaluator: eval.NewEvaluator(logger),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /evaluate", h.handleEvaluate)
	mux.HandleFunc("GET /health", h.handleHealth)
	mux.HandleFunc("GET /metrics", h.handleMetrics)
	return mux
}

// EvaluateRequest mirrors EvalInput from dt-eval-lib.
type EvaluateRequest struct {
	Metric         string  `json:"metric"`
	Input          string  `json:"input"`
	Output         string  `json:"output"`
	Context        *string `json:"context,omitempty"`
	ExpectedOutput *string `json:"expectedOutput,omitempty"`
	Trajectory     *string `json:"trajectory,omitempty"`
	Provider       string  `json:"provider"` // "openai" | "anthropic"
	Model          *string `json:"model,omitempty"`
}

// EvaluateResponse mirrors EvalResult from dt-eval-lib.
type EvaluateResponse struct {
	Score struct {
		Value float64 `json:"value"`
		Label string  `json:"label"` // "pass" | "fail"
	} `json:"score"`
	Explanation struct {
		Summary   string `json:"summary"`
		Reasoning string `json:"reasoning"`
	} `json:"explanation"`
}

func (h *Handler) handleEvaluate(w http.ResponseWriter, r *http.Request) {
	var req EvaluateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// TODO: call h.evaluator.Evaluate(r.Context(), req) when implemented
	h.logger.Info("evaluate request", "metric", req.Metric)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "not yet implemented"})
}

func (h *Handler) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	// TODO: return the full metric catalog (mirrors BuiltInMetric enum from dt-eval-lib)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "not yet implemented"})
}

## Repository instructions

- Pull request titles must follow the semantic format enforced by `.github/workflows/validate-pr-title.yaml`:
  - Allowed types: `feat`, `fix`, `build`, `chore`, `ci`, `docs`, `perf`, `refactor`, `revert`, `style`, `test`, `deps`
  - Allowed scopes: `main`, `dt-ai-ingest`, `dt-eval-lib`, `dt-eval-cli`
- Do not use issue IDs as the semantic scope. Put ticket references in the subject instead, for example:
  - `fix(dt-eval-cli): align bizevent read scope (AI-319)`

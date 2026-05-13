# Changelog

## [0.2.1-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.0-alpha...v0.2.1-alpha) (2026-05-13)


### ✨ New Features

* **dt-eval-cli:** make the run spinner reflect the actual phase ([#88](https://github.com/dynatrace-oss/dt-evals/issues/88)) ([1f2b333](https://github.com/dynatrace-oss/dt-evals/commit/1f2b333d6b62a75a29107fdcea8d4249bcf4848e))


### 📚 Documentation

* add status badges to root, CLI, and lib READMEs ([#81](https://github.com/dynatrace-oss/dt-evals/issues/81)) ([60914b2](https://github.com/dynatrace-oss/dt-evals/commit/60914b2e6c78baefe8a9a8b5172a7318dc8ea4d4))

## [0.2.0-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.1.4-alpha...v0.2.0-alpha) (2026-05-12)


### ⚠ BREAKING CHANGES

* rename CLI to dt-evals and resolve tsc strict-mode errors ([#65](https://github.com/dynatrace-oss/dt-evals/issues/65))

### ✨ New Features

* rename CLI to dt-evals and resolve tsc strict-mode errors ([#65](https://github.com/dynatrace-oss/dt-evals/issues/65)) ([06222a7](https://github.com/dynatrace-oss/dt-evals/commit/06222a73100981af08cfcb109f923c8721033dff))

## [0.1.4-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.1.3-alpha...v0.1.4-alpha) (2026-05-12)


### ✨ New Features

* add user frustration metrics replacing coherence ([#49](https://github.com/dynatrace-oss/dt-evals/issues/49)) ([1f58925](https://github.com/dynatrace-oss/dt-evals/commit/1f589251835867fb354ff20358b7efe84d149d79))
* configurable span field mapping and per-metric input routing ([#60](https://github.com/dynatrace-oss/dt-evals/issues/60)) ([1de09ae](https://github.com/dynatrace-oss/dt-evals/commit/1de09ae3ccf3a30ad31deccbb1e5719478af7242))
* platform tokens as primary auth, add dt-evals doctor command ([#59](https://github.com/dynatrace-oss/dt-evals/issues/59)) ([30e5567](https://github.com/dynatrace-oss/dt-evals/commit/30e55670cf5c584c22bc243cc7dde99cad5803b6))


### 🐛 Bug Fixes

* package structure for the CI ([#56](https://github.com/dynatrace-oss/dt-evals/issues/56)) ([9de7d55](https://github.com/dynatrace-oss/dt-evals/commit/9de7d55befa04d6deb8aead22f4313bd3406070e))


### 🧹 Chore

* bump @dynatrace-oss/dt-eval-lib to ^0.0.13-alpha ([#64](https://github.com/dynatrace-oss/dt-evals/issues/64)) ([81235bd](https://github.com/dynatrace-oss/dt-evals/commit/81235bd855a1655134434aba363b7fa5dced88cb))

## [0.1.3-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.1.2-alpha...v0.1.3-alpha) (2026-04-30)


### 🐛 Bug Fixes

* fix build for CLI ([#54](https://github.com/dynatrace-oss/dt-evals/issues/54)) ([591b20e](https://github.com/dynatrace-oss/dt-evals/commit/591b20eb53236d96804f0081a8df07bfc922fa4e))
* **main:** redact secretKey in configure --show output ([#51](https://github.com/dynatrace-oss/dt-evals/issues/51)) ([a77ca6c](https://github.com/dynatrace-oss/dt-evals/commit/a77ca6c44e682df55d3f41b7ae3f3ccc04729b0d))

## [0.1.2-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.1.1-alpha...v0.1.2-alpha) (2026-04-28)


### ✨ New Features

* add Azure OpenAI and Bedrock provider support ([#18](https://github.com/dynatrace-oss/dt-evals/issues/18)) ([0988a0e](https://github.com/dynatrace-oss/dt-evals/commit/0988a0e73ebd6db17e7eacfdf3f08b5830665ba4))
* **main:** prompt to run eval immediately after setup wizard ([#46](https://github.com/dynatrace-oss/dt-evals/issues/46)) ([9377f21](https://github.com/dynatrace-oss/dt-evals/commit/9377f218e4e86ddc7aa033f54a372a03b810971d))


### 🐛 Bug Fixes

* **dt-eval-lib:** remove Node.js builtins via PromptStore DI ([#43](https://github.com/dynatrace-oss/dt-evals/issues/43)) ([b6e8f39](https://github.com/dynatrace-oss/dt-evals/commit/b6e8f393d09b932a9cbcd12f3dc546ead416bf1d))


### 📚 Documentation

* update README for bedrock, azure-openai, and optional sampling ([#42](https://github.com/dynatrace-oss/dt-evals/issues/42)) ([f879ea4](https://github.com/dynatrace-oss/dt-evals/commit/f879ea46ffa30018190efa642b6c4f7a7718e255))

## [0.1.1-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.1.0-alpha...v0.1.1-alpha) (2026-04-17)


### ✨ New Features

* add Release Please support ([#20](https://github.com/dynatrace-oss/dt-evals/issues/20)) ([c39027d](https://github.com/dynatrace-oss/dt-evals/commit/c39027d5d16693f0e5097fc2cb598d9c2c8ea55f))

# Changelog

## [0.2.18-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.17-alpha...v0.2.18-alpha) (2026-08-13)


### 🐛 Bug Fixes

* bump vitest 2.x -&gt; 4.x to clear devDependency vulnerabilities ([#186](https://github.com/dynatrace-oss/dt-evals/issues/186)) ([47b1ec5](https://github.com/dynatrace-oss/dt-evals/commit/47b1ec579b92523f859941f74d7ee4328ef70572))

## [0.2.17-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.16-alpha...v0.2.17-alpha) (2026-08-12)


### 🐛 Bug Fixes

* **dt-eval-cli:** sort spans by start_time desc before the row limit (AI-389) ([#179](https://github.com/dynatrace-oss/dt-evals/issues/179)) ([e5efd28](https://github.com/dynatrace-oss/dt-evals/commit/e5efd283a5adac6e3079d8a04443b73af21834fd))

## [0.2.16-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.15-alpha...v0.2.16-alpha) (2026-08-11)


### 🐛 Bug Fixes

* **dt-eval-cli:** bump dt-eval-lib to 0.0.15-alpha ([#180](https://github.com/dynatrace-oss/dt-evals/issues/180)) ([31e3e7d](https://github.com/dynatrace-oss/dt-evals/commit/31e3e7d14a69f7599f24715b50984f14a9ec1b67))

## [0.2.15-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.14-alpha...v0.2.15-alpha) (2026-08-03)


### ✨ New Features

* **dt-eval-cli:** ai-337 add operation-name span filter ([#160](https://github.com/dynatrace-oss/dt-evals/issues/160)) ([3119def](https://github.com/dynatrace-oss/dt-evals/commit/3119deffc75d8568f27e14d13d8ffcefe39fdb07))


### 🐛 Bug Fixes

* **dt-eval-cli:** remove batch head-of-line blocking in eval runner ([#147](https://github.com/dynatrace-oss/dt-evals/issues/147)) ([1af4c53](https://github.com/dynatrace-oss/dt-evals/commit/1af4c532ed33defa7bfc6949f902e5c4b591e843))

## [0.2.14-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.13-alpha...v0.2.14-alpha) (2026-07-30)


### 🐛 Bug Fixes

* **dt-eval-cli:** route ingest to env-api on labs tenants ([#171](https://github.com/dynatrace-oss/dt-evals/issues/171)) ([43ed449](https://github.com/dynatrace-oss/dt-evals/commit/43ed449ba4fc5cc3d0b4e8c0da528b74b2c8ef3c))

## [0.2.13-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.12-alpha...v0.2.13-alpha) (2026-07-30)


### 🐛 Bug Fixes

* show evaluator result ratios ([#154](https://github.com/dynatrace-oss/dt-evals/issues/154)) ([1cc305d](https://github.com/dynatrace-oss/dt-evals/commit/1cc305d6b48d143ede1c2cc436a444b27271993e))

## [0.2.12-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.11-alpha...v0.2.12-alpha) (2026-07-29)


### 🐛 Bug Fixes

* **dt-eval-cli:** ai-336 align output messages parsing ([#159](https://github.com/dynatrace-oss/dt-evals/issues/159)) ([55263d8](https://github.com/dynatrace-oss/dt-evals/commit/55263d896ed0fb43db47df2321266f9213e334a9))

## [0.2.11-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.10-alpha...v0.2.11-alpha) (2026-07-24)


### 🐛 Bug Fixes

* **dt-eval-cli:** skip doctor ai probe without config (AI-319) ([#144](https://github.com/dynatrace-oss/dt-evals/issues/144)) ([6fd603b](https://github.com/dynatrace-oss/dt-evals/commit/6fd603b41858606b85d1ef05ee1e5e10ae12e804))
* **dt-eval-cli:** suggest correct default model per provider in wizard ([#138](https://github.com/dynatrace-oss/dt-evals/issues/138)) ([0c16412](https://github.com/dynatrace-oss/dt-evals/commit/0c1641233698862bb976184657c85242671da333))
* persist complete custom evaluator scoring ([#153](https://github.com/dynatrace-oss/dt-evals/issues/153)) ([4a39b19](https://github.com/dynatrace-oss/dt-evals/commit/4a39b19cc2616d132053c298eb4eed2e35a446ff))


### 📚 Documentation

* audit and fix dt-eval-lib, dt-eval-cli, and root README ([#146](https://github.com/dynatrace-oss/dt-evals/issues/146)) ([d78c66c](https://github.com/dynatrace-oss/dt-evals/commit/d78c66c82e0972fe24a9cdb6bb325345db69ed1a))
* **main:** correct bizevent read scope (AI-319) ([#143](https://github.com/dynatrace-oss/dt-evals/issues/143)) ([f4e98b9](https://github.com/dynatrace-oss/dt-evals/commit/f4e98b9e4abedd982399bad5e4268bd6a112f39e))

## [0.2.10-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.9-alpha...v0.2.10-alpha) (2026-07-22)


### 🐛 Bug Fixes

* **dt-eval-cli:** bump dt-eval-lib to 0.0.14-alpha ([#141](https://github.com/dynatrace-oss/dt-evals/issues/141)) ([e36e018](https://github.com/dynatrace-oss/dt-evals/commit/e36e0189b9cf7c0d8ffcb385c99d097bf2e04b14))

## [0.2.9-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.8-alpha...v0.2.9-alpha) (2026-07-22)


### 🐛 Bug Fixes

* **dt-eval-cli:** avoid leaking api keys across providers ([#129](https://github.com/dynatrace-oss/dt-evals/issues/129)) ([1d905f8](https://github.com/dynatrace-oss/dt-evals/commit/1d905f8ab859475c19fe59f8650e7266ec755f99))

## [0.2.8-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.7-alpha...v0.2.8-alpha) (2026-07-21)


### ✨ New Features

* **dt-eval-cli:** separate evaluator context from systemInstruction ([#136](https://github.com/dynatrace-oss/dt-evals/issues/136)) ([19db839](https://github.com/dynatrace-oss/dt-evals/commit/19db8390f378dfd2d5bf65410a94d9d4c814758a))
* support Vertex AI judge via Workload Identity / ADC ([#127](https://github.com/dynatrace-oss/dt-evals/issues/127)) ([b4e8921](https://github.com/dynatrace-oss/dt-evals/commit/b4e8921a25fb94154125e626c54f5028f113b36e))


### 🐛 Bug Fixes

* **dt-eval-cli:** default structured input to last user message ([#135](https://github.com/dynatrace-oss/dt-evals/issues/135)) ([8b29ead](https://github.com/dynatrace-oss/dt-evals/commit/8b29ead1e3074db193208f3683a07c668594ab58))


### 🧹 Chore

* sync prompt catalog from internal engine ([#131](https://github.com/dynatrace-oss/dt-evals/issues/131)) ([8f5ba2a](https://github.com/dynatrace-oss/dt-evals/commit/8f5ba2aa37e17b27217da0f8e9122a7f258ba493))

## [0.2.7-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.6-alpha...v0.2.7-alpha) (2026-07-13)


### ✨ New Features

* **dt-eval-cli:** store span start_time and end_time in bizevent pay… ([#126](https://github.com/dynatrace-oss/dt-evals/issues/126)) ([89bbb94](https://github.com/dynatrace-oss/dt-evals/commit/89bbb94700501dd1c0282bb72cc3810e856908b9))


### 🐛 Bug Fixes

* **dt-eval-cli:** stop sending evaluated prompt/response back to Dynatrace by default ([#122](https://github.com/dynatrace-oss/dt-evals/issues/122)) ([3fff13a](https://github.com/dynatrace-oss/dt-evals/commit/3fff13ae6bfdde9f31a92cdf7ea2ed8790df6daa))

## [0.2.6-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.5-alpha...v0.2.6-alpha) (2026-07-03)


### 🐛 Bug Fixes

* **dt-eval-lib:** support AWS SSO/temporary creds and markdown-fenced JSON for Bedrock ([#114](https://github.com/dynatrace-oss/dt-evals/issues/114)) ([48f9a28](https://github.com/dynatrace-oss/dt-evals/commit/48f9a2865fa48ac15be163e5f59be8baf529f895))

## [0.2.5-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.4-alpha...v0.2.5-alpha) (2026-06-12)


### 🐛 Bug Fixes

* **dt-eval-cli:** correct token scopes in README and parse gen_ai.output.messages ([#112](https://github.com/dynatrace-oss/dt-evals/issues/112)) ([42f4f17](https://github.com/dynatrace-oss/dt-evals/commit/42f4f172d894b693accfad325b732a2f67c7787e))

## [0.2.4-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.3-alpha...v0.2.4-alpha) (2026-06-11)


### 🐛 Bug Fixes

* **dt-eval-cli:** validate counts all failures and warns on default fallback ([#86](https://github.com/dynatrace-oss/dt-evals/issues/86)) ([0ecead9](https://github.com/dynatrace-oss/dt-evals/commit/0ecead9cdbce787bddc90a0922554c0f51afdf71))

## [0.2.3-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.2-alpha...v0.2.3-alpha) (2026-06-05)


### ✨ New Features

* **dt-eval-cli:** make judge concurrency configurable in yaml ([#87](https://github.com/dynatrace-oss/dt-evals/issues/87)) ([1ca39b1](https://github.com/dynatrace-oss/dt-evals/commit/1ca39b12c1b5a9d07dbc5bb012b18fe453a404cf))
* **dt-eval-cli:** split metric into metricId/metricName in bizevent payload ([#104](https://github.com/dynatrace-oss/dt-evals/issues/104)) ([fd1e639](https://github.com/dynatrace-oss/dt-evals/commit/fd1e639ecbe906414a4d684ff60fda7bb5fa12bc))
* **dt-eval-cli:** validate accepts a config file path argument ([#85](https://github.com/dynatrace-oss/dt-evals/issues/85)) ([7fff34d](https://github.com/dynatrace-oss/dt-evals/commit/7fff34d7c31d5ec9afeb42ca306672d0a4f9b691))


### 🐛 Bug Fixes

* **dt-eval-cli:** doctor uses paste-back platform token instead of dtctl OAuth ([#99](https://github.com/dynatrace-oss/dt-evals/issues/99)) ([9b33c7b](https://github.com/dynatrace-oss/dt-evals/commit/9b33c7bd607b6dd0bf27c59ed17b85caa06803b4))
* **dt-eval-cli:** persist eval errors + probe real model in doctor/validate ([#97](https://github.com/dynatrace-oss/dt-evals/issues/97)) ([4fe88da](https://github.com/dynatrace-oss/dt-evals/commit/4fe88da8defdf0b63cfa90bfebe65cc1f802d576))
* **dt-eval-cli:** use explicit DQL timeframe so --since over 2h returns data ([#84](https://github.com/dynatrace-oss/dt-evals/issues/84)) ([fc909b1](https://github.com/dynatrace-oss/dt-evals/commit/fc909b1365caf82c7448c74b951c85edb238bfad))


### 📚 Documentation

* link the public dt-evals playground dashboard ([#98](https://github.com/dynatrace-oss/dt-evals/issues/98)) ([ea3818d](https://github.com/dynatrace-oss/dt-evals/commit/ea3818d476b0b25f843b170dff19bdefa5f20dc5))

## [0.2.2-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.1-alpha...v0.2.2-alpha) (2026-05-14)


### 🐛 Bug Fixes

* **dt-eval-cli:** bundle LLM provider SDKs as direct dependencies ([#91](https://github.com/dynatrace-oss/dt-evals/issues/91)) ([11193a7](https://github.com/dynatrace-oss/dt-evals/commit/11193a7f08b8a45405c039649f6976275500d63a))

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

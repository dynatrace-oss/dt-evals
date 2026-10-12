# Changelog

## [0.4.0-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.3.4-alpha...v0.4.0-alpha) (2026-10-12)


### ⚠ BREAKING CHANGES

* **dt-eval-cli:** rename scope.mode → scope.level with agent-* values ([#223](https://github.com/dynatrace-oss/dt-evals/issues/223))
* rename CLI to dt-evals and resolve tsc strict-mode errors ([#65](https://github.com/dynatrace-oss/dt-evals/issues/65))

### ✨ New Features

* add Azure OpenAI and Bedrock provider support ([#18](https://github.com/dynatrace-oss/dt-evals/issues/18)) ([0988a0e](https://github.com/dynatrace-oss/dt-evals/commit/0988a0e73ebd6db17e7eacfdf3f08b5830665ba4))
* add input model/provider/agent fields to eval bizevent output, ref: NOISSUE ([#200](https://github.com/dynatrace-oss/dt-evals/issues/200)) ([df0efb6](https://github.com/dynatrace-oss/dt-evals/commit/df0efb67701baa24018d845a467d910195f048d1))
* add Release Please support ([#20](https://github.com/dynatrace-oss/dt-evals/issues/20)) ([c39027d](https://github.com/dynatrace-oss/dt-evals/commit/c39027d5d16693f0e5097fc2cb598d9c2c8ea55f))
* add user frustration metrics replacing coherence ([#49](https://github.com/dynatrace-oss/dt-evals/issues/49)) ([1f58925](https://github.com/dynatrace-oss/dt-evals/commit/1f589251835867fb354ff20358b7efe84d149d79))
* configurable span field mapping and per-metric input routing ([#60](https://github.com/dynatrace-oss/dt-evals/issues/60)) ([1de09ae](https://github.com/dynatrace-oss/dt-evals/commit/1de09ae3ccf3a30ad31deccbb1e5719478af7242))
* **dt-eval-cli:** add code-evals and agent-session example templates ([#237](https://github.com/dynatrace-oss/dt-evals/issues/237)) ([9068577](https://github.com/dynatrace-oss/dt-evals/commit/90685775922dc84d4b7fe4c6cee1dca1791c9093))
* **dt-eval-cli:** add conversation grouping and span selection for trajectory mode (AI-458-3) ([#212](https://github.com/dynatrace-oss/dt-evals/issues/212)) ([afd7356](https://github.com/dynatrace-oss/dt-evals/commit/afd7356d2669390828391ad3ecb27f0f0e962b93))
* **dt-eval-cli:** add evaluators --from-file and routing examples ([#234](https://github.com/dynatrace-oss/dt-evals/issues/234)) ([762817d](https://github.com/dynatrace-oss/dt-evals/commit/762817d49f9702c9368757fe26d4baaca77c4304))
* **dt-eval-cli:** add maxMessages truncation fallback for trajectory mode (AI-458-4) ([#213](https://github.com/dynatrace-oss/dt-evals/issues/213)) ([e4085cd](https://github.com/dynatrace-oss/dt-evals/commit/e4085cd01e8a0fe943f7ebb18098c0fba8665cf3))
* **dt-eval-cli:** add tool-call-accuracy example templates ([#240](https://github.com/dynatrace-oss/dt-evals/issues/240)) ([6653304](https://github.com/dynatrace-oss/dt-evals/commit/6653304f838fbdf5624ff32593a8d2dfd451a43f))
* **dt-eval-cli:** add trajectory mode flag and preserve full message history (AI-458-1+2) ([#215](https://github.com/dynatrace-oss/dt-evals/issues/215)) ([adbb15e](https://github.com/dynatrace-oss/dt-evals/commit/adbb15e1662fb25190bbbc7ac93f3d01b48460ff))
* **dt-eval-cli:** ai-337 add operation-name span filter ([#160](https://github.com/dynatrace-oss/dt-evals/issues/160)) ([3119def](https://github.com/dynatrace-oss/dt-evals/commit/3119deffc75d8568f27e14d13d8ffcefe39fdb07))
* **dt-eval-cli:** emit judge reasoning as a separate bizevent field ([#202](https://github.com/dynatrace-oss/dt-evals/issues/202)) ([a5d7e30](https://github.com/dynatrace-oss/dt-evals/commit/a5d7e305dff0d9169001217c9691a33f4b8414ae))
* **dt-eval-cli:** filter spans by arbitrary attributes ([#233](https://github.com/dynatrace-oss/dt-evals/issues/233)) ([3c3d287](https://github.com/dynatrace-oss/dt-evals/commit/3c3d2870d980cc7be18923a6ac6ea250d8810e57))
* **dt-eval-cli:** make judge concurrency configurable in yaml ([#87](https://github.com/dynatrace-oss/dt-evals/issues/87)) ([1ca39b1](https://github.com/dynatrace-oss/dt-evals/commit/1ca39b12c1b5a9d07dbc5bb012b18fe453a404cf))
* **dt-eval-cli:** make the run spinner reflect the actual phase ([#88](https://github.com/dynatrace-oss/dt-evals/issues/88)) ([1f2b333](https://github.com/dynatrace-oss/dt-evals/commit/1f2b333d6b62a75a29107fdcea8d4249bcf4848e))
* **dt-eval-cli:** print resolved config path and carry eval name in bizevents (AI-459) ([#217](https://github.com/dynatrace-oss/dt-evals/issues/217)) ([28ac860](https://github.com/dynatrace-oss/dt-evals/commit/28ac860dfbf207e2574d426dac7227c4d7fcaed9))
* **dt-eval-cli:** separate evaluator context from systemInstruction ([#136](https://github.com/dynatrace-oss/dt-evals/issues/136)) ([19db839](https://github.com/dynatrace-oss/dt-evals/commit/19db8390f378dfd2d5bf65410a94d9d4c814758a))
* **dt-eval-cli:** split metric into metricId/metricName in bizevent payload ([#104](https://github.com/dynatrace-oss/dt-evals/issues/104)) ([fd1e639](https://github.com/dynatrace-oss/dt-evals/commit/fd1e639ecbe906414a4d684ff60fda7bb5fa12bc))
* **dt-eval-cli:** store span start_time and end_time in bizevent pay… ([#126](https://github.com/dynatrace-oss/dt-evals/issues/126)) ([89bbb94](https://github.com/dynatrace-oss/dt-evals/commit/89bbb94700501dd1c0282bb72cc3810e856908b9))
* **dt-eval-cli:** surface scope level and code evals in the configure wizard ([#232](https://github.com/dynatrace-oss/dt-evals/issues/232)) ([10c596b](https://github.com/dynatrace-oss/dt-evals/commit/10c596bd5de23d90c6f4bb26ba5e9b87e9f45263))
* **dt-eval-cli:** validate accepts a config file path argument ([#85](https://github.com/dynatrace-oss/dt-evals/issues/85)) ([7fff34d](https://github.com/dynatrace-oss/dt-evals/commit/7fff34d7c31d5ec9afeb42ca306672d0a4f9b691))
* **dt-eval-cli:** wire deterministic evaluators (config, runner, telemetry) ([#197](https://github.com/dynatrace-oss/dt-evals/issues/197)) ([325079f](https://github.com/dynatrace-oss/dt-evals/commit/325079f17d6f004c8abf09d97ae12d8134dd0d9e))
* **dt-eval-lib:** add output-prompt-injection evaluator for agent-emitted injection ([#224](https://github.com/dynatrace-oss/dt-evals/issues/224)) ([bc7074c](https://github.com/dynatrace-oss/dt-evals/commit/bc7074c40587f854e3a07766109be8364938d888))
* **main:** prompt to run eval immediately after setup wizard ([#46](https://github.com/dynatrace-oss/dt-evals/issues/46)) ([9377f21](https://github.com/dynatrace-oss/dt-evals/commit/9377f218e4e86ddc7aa033f54a372a03b810971d))
* platform tokens as primary auth, add dt-evals doctor command ([#59](https://github.com/dynatrace-oss/dt-evals/issues/59)) ([30e5567](https://github.com/dynatrace-oss/dt-evals/commit/30e55670cf5c584c22bc243cc7dde99cad5803b6))
* rename CLI to dt-evals and resolve tsc strict-mode errors ([#65](https://github.com/dynatrace-oss/dt-evals/issues/65)) ([06222a7](https://github.com/dynatrace-oss/dt-evals/commit/06222a73100981af08cfcb109f923c8721033dff))
* support Vertex AI judge via Workload Identity / ADC ([#127](https://github.com/dynatrace-oss/dt-evals/issues/127)) ([b4e8921](https://github.com/dynatrace-oss/dt-evals/commit/b4e8921a25fb94154125e626c54f5028f113b36e))


### 🐛 Bug Fixes

* bump vitest 2.x -&gt; 4.x to clear devDependency vulnerabilities ([#186](https://github.com/dynatrace-oss/dt-evals/issues/186)) ([47b1ec5](https://github.com/dynatrace-oss/dt-evals/commit/47b1ec579b92523f859941f74d7ee4328ef70572))
* clear dependency-audit vulnerabilities across all workspaces ([#193](https://github.com/dynatrace-oss/dt-evals/issues/193)) ([e75594e](https://github.com/dynatrace-oss/dt-evals/commit/e75594e13c35a19e8e897c782de8e38167d32ef6))
* **dt-eval-cli:** ai-336 align output messages parsing ([#159](https://github.com/dynatrace-oss/dt-evals/issues/159)) ([55263d8](https://github.com/dynatrace-oss/dt-evals/commit/55263d896ed0fb43db47df2321266f9213e334a9))
* **dt-eval-cli:** avoid leaking api keys across providers ([#129](https://github.com/dynatrace-oss/dt-evals/issues/129)) ([1d905f8](https://github.com/dynatrace-oss/dt-evals/commit/1d905f8ab859475c19fe59f8650e7266ec755f99))
* **dt-eval-cli:** bump dt-eval-lib to 0.0.14-alpha ([#141](https://github.com/dynatrace-oss/dt-evals/issues/141)) ([e36e018](https://github.com/dynatrace-oss/dt-evals/commit/e36e0189b9cf7c0d8ffcb385c99d097bf2e04b14))
* **dt-eval-cli:** bump dt-eval-lib to 0.0.15-alpha ([#180](https://github.com/dynatrace-oss/dt-evals/issues/180)) ([31e3e7d](https://github.com/dynatrace-oss/dt-evals/commit/31e3e7d14a69f7599f24715b50984f14a9ec1b67))
* **dt-eval-cli:** bundle LLM provider SDKs as direct dependencies ([#91](https://github.com/dynatrace-oss/dt-evals/issues/91)) ([11193a7](https://github.com/dynatrace-oss/dt-evals/commit/11193a7f08b8a45405c039649f6976275500d63a))
* **dt-eval-cli:** correct token scopes in README and parse gen_ai.output.messages ([#112](https://github.com/dynatrace-oss/dt-evals/issues/112)) ([42f4f17](https://github.com/dynatrace-oss/dt-evals/commit/42f4f172d894b693accfad325b732a2f67c7787e))
* **dt-eval-cli:** default structured input to last user message ([#135](https://github.com/dynatrace-oss/dt-evals/issues/135)) ([8b29ead](https://github.com/dynatrace-oss/dt-evals/commit/8b29ead1e3074db193208f3683a07c668594ab58))
* **dt-eval-cli:** doctor uses paste-back platform token instead of dtctl OAuth ([#99](https://github.com/dynatrace-oss/dt-evals/issues/99)) ([9b33c7b](https://github.com/dynatrace-oss/dt-evals/commit/9b33c7bd607b6dd0bf27c59ed17b85caa06803b4))
* **dt-eval-cli:** keep execute_tool spans in the genai-span filter ([#239](https://github.com/dynatrace-oss/dt-evals/issues/239)) ([3ce51d7](https://github.com/dynatrace-oss/dt-evals/commit/3ce51d726e429a1b74b3619d7a3666cedd818cb4))
* **dt-eval-cli:** persist eval errors + probe real model in doctor/validate ([#97](https://github.com/dynatrace-oss/dt-evals/issues/97)) ([4fe88da](https://github.com/dynatrace-oss/dt-evals/commit/4fe88da8defdf0b63cfa90bfebe65cc1f802d576))
* **dt-eval-cli:** remove batch head-of-line blocking in eval runner ([#147](https://github.com/dynatrace-oss/dt-evals/issues/147)) ([1af4c53](https://github.com/dynatrace-oss/dt-evals/commit/1af4c532ed33defa7bfc6949f902e5c4b591e843))
* **dt-eval-cli:** report pass rate from scores, not completions ([#236](https://github.com/dynatrace-oss/dt-evals/issues/236)) ([6ffbe51](https://github.com/dynatrace-oss/dt-evals/commit/6ffbe516bb006e9a316b5620ea7936d318d8559b))
* **dt-eval-cli:** route ingest to env-api on labs tenants ([#171](https://github.com/dynatrace-oss/dt-evals/issues/171)) ([43ed449](https://github.com/dynatrace-oss/dt-evals/commit/43ed449ba4fc5cc3d0b4e8c0da528b74b2c8ef3c))
* **dt-eval-cli:** skip doctor ai probe without config (AI-319) ([#144](https://github.com/dynatrace-oss/dt-evals/issues/144)) ([6fd603b](https://github.com/dynatrace-oss/dt-evals/commit/6fd603b41858606b85d1ef05ee1e5e10ae12e804))
* **dt-eval-cli:** sort spans by start_time desc before the row limit (AI-389) ([#179](https://github.com/dynatrace-oss/dt-evals/issues/179)) ([e5efd28](https://github.com/dynatrace-oss/dt-evals/commit/e5efd283a5adac6e3079d8a04443b73af21834fd))
* **dt-eval-cli:** stop sending evaluated prompt/response back to Dynatrace by default ([#122](https://github.com/dynatrace-oss/dt-evals/issues/122)) ([3fff13a](https://github.com/dynatrace-oss/dt-evals/commit/3fff13ae6bfdde9f31a92cdf7ea2ed8790df6daa))
* **dt-eval-cli:** suggest correct default model per provider in wizard ([#138](https://github.com/dynatrace-oss/dt-evals/issues/138)) ([0c16412](https://github.com/dynatrace-oss/dt-evals/commit/0c1641233698862bb976184657c85242671da333))
* **dt-eval-cli:** update playground dashboard link (AI-230) ([#230](https://github.com/dynatrace-oss/dt-evals/issues/230)) ([9be39a2](https://github.com/dynatrace-oss/dt-evals/commit/9be39a28e48694f8ce7b9420291cf184d3fb691f))
* **dt-eval-cli:** use explicit DQL timeframe so --since over 2h returns data ([#84](https://github.com/dynatrace-oss/dt-evals/issues/84)) ([fc909b1](https://github.com/dynatrace-oss/dt-evals/commit/fc909b1365caf82c7448c74b951c85edb238bfad))
* **dt-eval-cli:** validate counts all failures and warns on default fallback ([#86](https://github.com/dynatrace-oss/dt-evals/issues/86)) ([0ecead9](https://github.com/dynatrace-oss/dt-evals/commit/0ecead9cdbce787bddc90a0922554c0f51afdf71))
* **dt-eval-lib:** exact_match takes its expected value from config only ([#222](https://github.com/dynatrace-oss/dt-evals/issues/222)) ([5d0cc84](https://github.com/dynatrace-oss/dt-evals/commit/5d0cc8405e69343ca659f5e835f346060decef56))
* **dt-eval-lib:** remove Node.js builtins via PromptStore DI ([#43](https://github.com/dynatrace-oss/dt-evals/issues/43)) ([b6e8f39](https://github.com/dynatrace-oss/dt-evals/commit/b6e8f393d09b932a9cbcd12f3dc546ead416bf1d))
* **dt-eval-lib:** support AWS SSO/temporary creds and markdown-fenced JSON for Bedrock ([#114](https://github.com/dynatrace-oss/dt-evals/issues/114)) ([48f9a28](https://github.com/dynatrace-oss/dt-evals/commit/48f9a2865fa48ac15be163e5f59be8baf529f895))
* fix build for CLI ([#54](https://github.com/dynatrace-oss/dt-evals/issues/54)) ([591b20e](https://github.com/dynatrace-oss/dt-evals/commit/591b20eb53236d96804f0081a8df07bfc922fa4e))
* **main:** redact secretKey in configure --show output ([#51](https://github.com/dynatrace-oss/dt-evals/issues/51)) ([a77ca6c](https://github.com/dynatrace-oss/dt-evals/commit/a77ca6c44e682df55d3f41b7ae3f3ccc04729b0d))
* package structure for the CI ([#56](https://github.com/dynatrace-oss/dt-evals/issues/56)) ([9de7d55](https://github.com/dynatrace-oss/dt-evals/commit/9de7d55befa04d6deb8aead22f4313bd3406070e))
* persist complete custom evaluator scoring ([#153](https://github.com/dynatrace-oss/dt-evals/issues/153)) ([4a39b19](https://github.com/dynatrace-oss/dt-evals/commit/4a39b19cc2616d132053c298eb4eed2e35a446ff))
* show evaluator result ratios ([#154](https://github.com/dynatrace-oss/dt-evals/issues/154)) ([1cc305d](https://github.com/dynatrace-oss/dt-evals/commit/1cc305d6b48d143ede1c2cc436a444b27271993e))


### 🧹 Chore

* bump @dynatrace-oss/dt-eval-lib to ^0.0.13-alpha ([#64](https://github.com/dynatrace-oss/dt-evals/issues/64)) ([81235bd](https://github.com/dynatrace-oss/dt-evals/commit/81235bd855a1655134434aba363b7fa5dced88cb))
* release 0.1.1-alpha ([#22](https://github.com/dynatrace-oss/dt-evals/issues/22)) ([5fa71b5](https://github.com/dynatrace-oss/dt-evals/commit/5fa71b56f271ad9ccf20ade8a60b03ab32ab62d5))
* release 0.1.2-alpha ([#41](https://github.com/dynatrace-oss/dt-evals/issues/41)) ([5915102](https://github.com/dynatrace-oss/dt-evals/commit/5915102c6a2f8e5d460ad0d34c4803821ab7b68d))
* release 0.1.3-alpha ([#55](https://github.com/dynatrace-oss/dt-evals/issues/55)) ([b8615e2](https://github.com/dynatrace-oss/dt-evals/commit/b8615e2a845bc658badd9e7ed8fbc550451217dc))
* release 0.1.4-alpha ([#57](https://github.com/dynatrace-oss/dt-evals/issues/57)) ([1aaac5d](https://github.com/dynatrace-oss/dt-evals/commit/1aaac5d0ffcff0f2ae942b677d08d4e00c04948f))
* release 0.2.0-alpha ([#66](https://github.com/dynatrace-oss/dt-evals/issues/66)) ([2a76907](https://github.com/dynatrace-oss/dt-evals/commit/2a7690777a8dcdc6fbfdc50efce0cb6d17061b8f))
* release 0.2.1-alpha ([#82](https://github.com/dynatrace-oss/dt-evals/issues/82)) ([8de8a63](https://github.com/dynatrace-oss/dt-evals/commit/8de8a639dc7de1677ecf9caf18b88afc1e32bc8f))
* release 0.2.10-alpha ([#142](https://github.com/dynatrace-oss/dt-evals/issues/142)) ([938b385](https://github.com/dynatrace-oss/dt-evals/commit/938b385844dc2e8e71ffd0932109f940e39f0ee0))
* release 0.2.11-alpha ([#145](https://github.com/dynatrace-oss/dt-evals/issues/145)) ([659ef09](https://github.com/dynatrace-oss/dt-evals/commit/659ef09f91008d1978feadf82273f8c878394579))
* release 0.2.12-alpha ([#169](https://github.com/dynatrace-oss/dt-evals/issues/169)) ([1c304e1](https://github.com/dynatrace-oss/dt-evals/commit/1c304e1266dba2f880213bc5d677bf5dde57449b))
* release 0.2.13-alpha ([#172](https://github.com/dynatrace-oss/dt-evals/issues/172)) ([f0e332f](https://github.com/dynatrace-oss/dt-evals/commit/f0e332f71c76ac61d22bfdb60b9b4d9b87bc8d82))
* release 0.2.14-alpha ([#173](https://github.com/dynatrace-oss/dt-evals/issues/173)) ([f7aedee](https://github.com/dynatrace-oss/dt-evals/commit/f7aedee5b7d5d866e1977b595ff7ddc2c69b6fcf))
* release 0.2.15-alpha ([#175](https://github.com/dynatrace-oss/dt-evals/issues/175)) ([540d70e](https://github.com/dynatrace-oss/dt-evals/commit/540d70e0a1f345fbf62eb61b5631655fe027b458))
* release 0.2.16-alpha ([#181](https://github.com/dynatrace-oss/dt-evals/issues/181)) ([2f72340](https://github.com/dynatrace-oss/dt-evals/commit/2f723407ad565164aeb8bbe1c007adde7cf959a6))
* release 0.2.17-alpha ([#185](https://github.com/dynatrace-oss/dt-evals/issues/185)) ([2e2fd5f](https://github.com/dynatrace-oss/dt-evals/commit/2e2fd5f3b4456bc0bd0f4711d124cce5c6bdc059))
* release 0.2.18-alpha ([#189](https://github.com/dynatrace-oss/dt-evals/issues/189)) ([550e612](https://github.com/dynatrace-oss/dt-evals/commit/550e612bd2a51ebaf37bcaecea835266f31934e5))
* release 0.2.19-alpha ([#194](https://github.com/dynatrace-oss/dt-evals/issues/194)) ([c03e771](https://github.com/dynatrace-oss/dt-evals/commit/c03e771ab30f68d633968006fc58b74b7c53b76c))
* release 0.2.2-alpha ([#92](https://github.com/dynatrace-oss/dt-evals/issues/92)) ([85661d6](https://github.com/dynatrace-oss/dt-evals/commit/85661d6e7f93a6b01729747a8a35dafa684ca85a))
* release 0.2.20-alpha ([#201](https://github.com/dynatrace-oss/dt-evals/issues/201)) ([304f4b2](https://github.com/dynatrace-oss/dt-evals/commit/304f4b267bc49f9f77344a2fd42b977a9a0d631b))
* release 0.2.21-alpha ([#203](https://github.com/dynatrace-oss/dt-evals/issues/203)) ([74870ab](https://github.com/dynatrace-oss/dt-evals/commit/74870ab96007645c85b5a8ec45bc954d99cbe6ba))
* release 0.2.22-alpha ([#205](https://github.com/dynatrace-oss/dt-evals/issues/205)) ([0684f69](https://github.com/dynatrace-oss/dt-evals/commit/0684f69ec602f34522124bd388dff474fdbc2561))
* release 0.2.23-alpha ([#208](https://github.com/dynatrace-oss/dt-evals/issues/208)) ([e30cb1f](https://github.com/dynatrace-oss/dt-evals/commit/e30cb1f210fd13c9e0814b2b28d3d7b3d87719ad))
* release 0.2.24-alpha ([#218](https://github.com/dynatrace-oss/dt-evals/issues/218)) ([c160c32](https://github.com/dynatrace-oss/dt-evals/commit/c160c32eef4532e554a4220fe7ad71cd3802d928))
* release 0.2.25-alpha ([#219](https://github.com/dynatrace-oss/dt-evals/issues/219)) ([07fb982](https://github.com/dynatrace-oss/dt-evals/commit/07fb982ff244bdef32034b5be85f94fae76e43e5))
* release 0.2.26-alpha ([#226](https://github.com/dynatrace-oss/dt-evals/issues/226)) ([b89d0c8](https://github.com/dynatrace-oss/dt-evals/commit/b89d0c86f9ffdb5afcc1bdcfc9db5090c0c72430))
* release 0.2.3-alpha ([#95](https://github.com/dynatrace-oss/dt-evals/issues/95)) ([9a64c33](https://github.com/dynatrace-oss/dt-evals/commit/9a64c334c3c79d2aadb41f25f820299d229c32d6))
* release 0.2.4-alpha ([#108](https://github.com/dynatrace-oss/dt-evals/issues/108)) ([e09ba17](https://github.com/dynatrace-oss/dt-evals/commit/e09ba17a25444a2572b01b2337580ba140636b40))
* release 0.2.5-alpha ([#113](https://github.com/dynatrace-oss/dt-evals/issues/113)) ([24498d2](https://github.com/dynatrace-oss/dt-evals/commit/24498d236a551265e3246b741fcd86a9cd65ff01))
* release 0.2.6-alpha ([#120](https://github.com/dynatrace-oss/dt-evals/issues/120)) ([1c0f9eb](https://github.com/dynatrace-oss/dt-evals/commit/1c0f9ebb4801d6a18df59856f2697598aafbf907))
* release 0.2.7-alpha ([#123](https://github.com/dynatrace-oss/dt-evals/issues/123)) ([d18af6c](https://github.com/dynatrace-oss/dt-evals/commit/d18af6c9973fc1bf55175249c9db4789e8b75333))
* release 0.2.8-alpha ([#134](https://github.com/dynatrace-oss/dt-evals/issues/134)) ([4d2403e](https://github.com/dynatrace-oss/dt-evals/commit/4d2403e2eee1a174fc44cf1a4666d975cdcba59f))
* release 0.2.9-alpha ([#139](https://github.com/dynatrace-oss/dt-evals/issues/139)) ([6b5f875](https://github.com/dynatrace-oss/dt-evals/commit/6b5f875094221ece43217e3adf5692731f740f95))
* release 0.3.0-alpha ([#227](https://github.com/dynatrace-oss/dt-evals/issues/227)) ([7022c5c](https://github.com/dynatrace-oss/dt-evals/commit/7022c5c8ef6436c5058ca1a9f1dff2441c7cef7d))
* release 0.3.1-alpha ([#228](https://github.com/dynatrace-oss/dt-evals/issues/228)) ([6261c43](https://github.com/dynatrace-oss/dt-evals/commit/6261c43f7741b33657e28493ce4cc25928adf21e))
* release 0.3.2-alpha ([#235](https://github.com/dynatrace-oss/dt-evals/issues/235)) ([a33a55e](https://github.com/dynatrace-oss/dt-evals/commit/a33a55e5f5b0372534e6005f24f2ca4766984983))
* release 0.3.3-alpha ([#238](https://github.com/dynatrace-oss/dt-evals/issues/238)) ([e1c029a](https://github.com/dynatrace-oss/dt-evals/commit/e1c029ad42b8d8404b3d442473739c5def52d529))
* sync prompt catalog from internal engine ([#131](https://github.com/dynatrace-oss/dt-evals/issues/131)) ([8f5ba2a](https://github.com/dynatrace-oss/dt-evals/commit/8f5ba2aa37e17b27217da0f8e9122a7f258ba493))


### 📚 Documentation

* add status badges to root, CLI, and lib READMEs ([#81](https://github.com/dynatrace-oss/dt-evals/issues/81)) ([60914b2](https://github.com/dynatrace-oss/dt-evals/commit/60914b2e6c78baefe8a9a8b5172a7318dc8ea4d4))
* audit and fix dt-eval-lib, dt-eval-cli, and root README ([#146](https://github.com/dynatrace-oss/dt-evals/issues/146)) ([d78c66c](https://github.com/dynatrace-oss/dt-evals/commit/d78c66c82e0972fe24a9cdb6bb325345db69ed1a))
* **dt-eval-cli:** add demo video link to README ([#231](https://github.com/dynatrace-oss/dt-evals/issues/231)) ([9504838](https://github.com/dynatrace-oss/dt-evals/commit/9504838b729a4a4f190478fa531b70daa2d42981))
* **dt-eval-cli:** add deterministic evaluator examples (AI-454) ([#207](https://github.com/dynatrace-oss/dt-evals/issues/207)) ([ee09c0f](https://github.com/dynatrace-oss/dt-evals/commit/ee09c0f045c7b6beba659a25ef5e93817c207cee))
* link the public dt-evals playground dashboard ([#98](https://github.com/dynatrace-oss/dt-evals/issues/98)) ([ea3818d](https://github.com/dynatrace-oss/dt-evals/commit/ea3818d476b0b25f843b170dff19bdefa5f20dc5))
* **main:** correct bizevent read scope (AI-319) ([#143](https://github.com/dynatrace-oss/dt-evals/issues/143)) ([f4e98b9](https://github.com/dynatrace-oss/dt-evals/commit/f4e98b9e4abedd982399bad5e4268bd6a112f39e))
* update README for bedrock, azure-openai, and optional sampling ([#42](https://github.com/dynatrace-oss/dt-evals/issues/42)) ([f879ea4](https://github.com/dynatrace-oss/dt-evals/commit/f879ea46ffa30018190efa642b6c4f7a7718e255))


### 🔄 Refactoring

* **dt-eval-cli:** rename scope.mode → scope.level with agent-* values ([#223](https://github.com/dynatrace-oss/dt-evals/issues/223)) ([332ab3a](https://github.com/dynatrace-oss/dt-evals/commit/332ab3af4beb83a21657ec95ddbe3409abd02b5c))

## [0.3.3-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.3.2-alpha...v0.3.3-alpha) (2026-09-10)


### ✨ New Features

* **dt-eval-cli:** add code-evals and agent-session example templates ([#237](https://github.com/dynatrace-oss/dt-evals/issues/237)) ([9068577](https://github.com/dynatrace-oss/dt-evals/commit/90685775922dc84d4b7fe4c6cee1dca1791c9093))
* **dt-eval-cli:** add tool-call-accuracy example templates ([#240](https://github.com/dynatrace-oss/dt-evals/issues/240)) ([6653304](https://github.com/dynatrace-oss/dt-evals/commit/6653304f838fbdf5624ff32593a8d2dfd451a43f))


### 🐛 Bug Fixes

* **dt-eval-cli:** keep execute_tool spans in the genai-span filter ([#239](https://github.com/dynatrace-oss/dt-evals/issues/239)) ([3ce51d7](https://github.com/dynatrace-oss/dt-evals/commit/3ce51d726e429a1b74b3619d7a3666cedd818cb4))
* **dt-eval-cli:** report pass rate from scores, not completions ([#236](https://github.com/dynatrace-oss/dt-evals/issues/236)) ([6ffbe51](https://github.com/dynatrace-oss/dt-evals/commit/6ffbe516bb006e9a316b5620ea7936d318d8559b))

## [0.3.2-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.3.1-alpha...v0.3.2-alpha) (2026-09-09)


### ✨ New Features

* **dt-eval-cli:** add evaluators --from-file and routing examples ([#234](https://github.com/dynatrace-oss/dt-evals/issues/234)) ([762817d](https://github.com/dynatrace-oss/dt-evals/commit/762817d49f9702c9368757fe26d4baaca77c4304))
* **dt-eval-cli:** filter spans by arbitrary attributes ([#233](https://github.com/dynatrace-oss/dt-evals/issues/233)) ([3c3d287](https://github.com/dynatrace-oss/dt-evals/commit/3c3d2870d980cc7be18923a6ac6ea250d8810e57))

## [0.3.1-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.3.0-alpha...v0.3.1-alpha) (2026-09-07)


### ✨ New Features

* **dt-eval-cli:** surface scope level and code evals in the configure wizard ([#232](https://github.com/dynatrace-oss/dt-evals/issues/232)) ([10c596b](https://github.com/dynatrace-oss/dt-evals/commit/10c596bd5de23d90c6f4bb26ba5e9b87e9f45263))
* **dt-eval-lib:** add output-prompt-injection evaluator for agent-emitted injection ([#224](https://github.com/dynatrace-oss/dt-evals/issues/224)) ([bc7074c](https://github.com/dynatrace-oss/dt-evals/commit/bc7074c40587f854e3a07766109be8364938d888))


### 🐛 Bug Fixes

* **dt-eval-cli:** update playground dashboard link (AI-230) ([#230](https://github.com/dynatrace-oss/dt-evals/issues/230)) ([9be39a2](https://github.com/dynatrace-oss/dt-evals/commit/9be39a28e48694f8ce7b9420291cf184d3fb691f))


### 📚 Documentation

* **dt-eval-cli:** add demo video link to README ([#231](https://github.com/dynatrace-oss/dt-evals/issues/231)) ([9504838](https://github.com/dynatrace-oss/dt-evals/commit/9504838b729a4a4f190478fa531b70daa2d42981))

## [0.3.0-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.26-alpha...v0.3.0-alpha) (2026-09-01)


### ⚠ BREAKING CHANGES

* **dt-eval-cli:** rename scope.mode → scope.level with agent-* values ([#223](https://github.com/dynatrace-oss/dt-evals/issues/223))

### 🔄 Refactoring

* **dt-eval-cli:** rename scope.mode → scope.level with agent-* values ([#223](https://github.com/dynatrace-oss/dt-evals/issues/223)) ([332ab3a](https://github.com/dynatrace-oss/dt-evals/commit/332ab3af4beb83a21657ec95ddbe3409abd02b5c))

## [0.2.26-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.25-alpha...v0.2.26-alpha) (2026-09-01)


### 🐛 Bug Fixes

* **dt-eval-lib:** exact_match takes its expected value from config only ([#222](https://github.com/dynatrace-oss/dt-evals/issues/222)) ([5d0cc84](https://github.com/dynatrace-oss/dt-evals/commit/5d0cc8405e69343ca659f5e835f346060decef56))

## [0.2.25-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.24-alpha...v0.2.25-alpha) (2026-08-28)


### ✨ New Features

* **dt-eval-cli:** add conversation grouping and span selection for trajectory mode (AI-458-3) ([#212](https://github.com/dynatrace-oss/dt-evals/issues/212)) ([afd7356](https://github.com/dynatrace-oss/dt-evals/commit/afd7356d2669390828391ad3ecb27f0f0e962b93))
* **dt-eval-cli:** add maxMessages truncation fallback for trajectory mode (AI-458-4) ([#213](https://github.com/dynatrace-oss/dt-evals/issues/213)) ([e4085cd](https://github.com/dynatrace-oss/dt-evals/commit/e4085cd01e8a0fe943f7ebb18098c0fba8665cf3))
* **dt-eval-cli:** add trajectory mode flag and preserve full message history (AI-458-1+2) ([#215](https://github.com/dynatrace-oss/dt-evals/issues/215)) ([adbb15e](https://github.com/dynatrace-oss/dt-evals/commit/adbb15e1662fb25190bbbc7ac93f3d01b48460ff))

## [0.2.24-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.23-alpha...v0.2.24-alpha) (2026-08-28)


### ✨ New Features

* **dt-eval-cli:** print resolved config path and carry eval name in bizevents (AI-459) ([#217](https://github.com/dynatrace-oss/dt-evals/issues/217)) ([28ac860](https://github.com/dynatrace-oss/dt-evals/commit/28ac860dfbf207e2574d426dac7227c4d7fcaed9))

## [0.2.23-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.22-alpha...v0.2.23-alpha) (2026-08-26)


### 📚 Documentation

* **dt-eval-cli:** add deterministic evaluator examples (AI-454) ([#207](https://github.com/dynatrace-oss/dt-evals/issues/207)) ([ee09c0f](https://github.com/dynatrace-oss/dt-evals/commit/ee09c0f045c7b6beba659a25ef5e93817c207cee))

## [0.2.22-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.21-alpha...v0.2.22-alpha) (2026-08-20)


### ✨ New Features

* **dt-eval-cli:** wire deterministic evaluators (config, runner, telemetry) ([#197](https://github.com/dynatrace-oss/dt-evals/issues/197)) ([325079f](https://github.com/dynatrace-oss/dt-evals/commit/325079f17d6f004c8abf09d97ae12d8134dd0d9e))

## [0.2.21-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.20-alpha...v0.2.21-alpha) (2026-08-19)


### ✨ New Features

* **dt-eval-cli:** emit judge reasoning as a separate bizevent field ([#202](https://github.com/dynatrace-oss/dt-evals/issues/202)) ([a5d7e30](https://github.com/dynatrace-oss/dt-evals/commit/a5d7e305dff0d9169001217c9691a33f4b8414ae))

## [0.2.20-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.19-alpha...v0.2.20-alpha) (2026-08-18)


### ✨ New Features

* add input model/provider/agent fields to eval bizevent output, ref: NOISSUE ([#200](https://github.com/dynatrace-oss/dt-evals/issues/200)) ([df0efb6](https://github.com/dynatrace-oss/dt-evals/commit/df0efb67701baa24018d845a467d910195f048d1))

## [0.2.19-alpha](https://github.com/dynatrace-oss/dt-evals/compare/v0.2.18-alpha...v0.2.19-alpha) (2026-08-14)


### 🐛 Bug Fixes

* clear dependency-audit vulnerabilities across all workspaces ([#193](https://github.com/dynatrace-oss/dt-evals/issues/193)) ([e75594e](https://github.com/dynatrace-oss/dt-evals/commit/e75594e13c35a19e8e897c782de8e38167d32ef6))

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

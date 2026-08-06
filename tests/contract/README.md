# Contract tests

IMPLEMENT_LATER. Producer/consumer contract tests against the shared OpenAPI contract (`packages/contracts`) apply once `apps/api` exposes domain endpoints beyond health checks — see `ADR-0005` §7/§8 and `05_03` v1.2's cross-repository gate list ("contract test producer/consumer" is mandatory before a shared-contract change may ship). At WEB-M0 there is no domain endpoint to contract-test yet.

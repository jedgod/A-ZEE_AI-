# Extension safety rules

- Only reviewed static imports in the registry are allowlisted. No uploaded packages, arbitrary entrypoints, or dynamic code loading.
- Every extension declares explicit permissions and a versioned manifest. Tenant approval pins the version; changed versions require reapproval.
- Activation requires authenticated administrator review. Caller rights and tenant grants must both cover every requested permission.
- Never pass raw secrets to extensions. Project only approved context/output fields; review those fields for sensitive content before dispatch.
- Extensions cannot replace identity, routing decisions, policy results, or delivery approvals. Hook outputs are namespaced metadata only.
- Extension code must not write core tables. Use approved host-mediated operations and a database role restricted to extension tables.
- Persist sanitized operational audit events for execution and configuration. Never record raw content, secrets, or private reasoning.

These rules are mandatory review and deployment requirements. Static TypeScript interfaces cannot isolate code: reviewed in-process imports can access process resources. Untrusted packages must run in a separate hardened service without host secrets, core database credentials, or unrestricted network access. Such packages are not supported by this runtime.

Authentication is deliberately disabled until the host session adapter is implemented. Configuration and audit writes currently require a host transaction integration before production. Use an independent protected audit sink and retention jobs. Package signatures, sandbox execution, an audit dashboard, and third-party installation are future work, not implemented features.

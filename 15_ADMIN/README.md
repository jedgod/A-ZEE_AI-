# 15_ADMIN — Governance and control plane

## Purpose
This layer adds enterprise control over the application core. It is responsible for multi-tenant boundaries, identity governance, approval workflows, policy enforcement, model registry review, billing oversight, and operational incident handling.

## Modules
- dashboard
- tenants
- users
- roles
- approvals
- policies
- registry
- billing
- incidents

## Core concerns
- Tenant segmentation and workspace ownership
- Role-based access control (owner, admin, reviewer, operator, viewer)
- Approval flows for model activation, extension enablement, and tool access
- Policy enforcement and audit review
- Registry governance for models and version approvals
- Budget, usage, and latency visibility
- Incident triage and remediation workflows

## Stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- PostgreSQL or SQLite
- Zod validation for admin payloads

## Required integration
- Connect to your session/auth provider and tenant identity model.
- Enforce permission checks in every admin API route.
- Write audit events for configuration, approval, policy, and billing changes.
- Bind operations to tenant ownership; never allow cross-tenant reads or writes.

## Suggested first implementation
Start with the dashboard and approval queue, then add tenant and role management. Use the same allowlist pattern as the extension layer: only approved models, policies, and workflows should be executable.

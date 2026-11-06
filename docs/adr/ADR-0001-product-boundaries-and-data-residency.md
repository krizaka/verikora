# ADR-0001 — Product Boundaries, Multi-Region Residency (Quebec Law 25), and Trust Integration: Verikora vs. Orasaka vs. a client platform

- **Status:** accepted — 2026-10-16 (ratified in krizaka/verikora#29 and discussion #30)
- **Scope:** Verikora (`krizaka/verikora`), Orasaka (`krizaka/sovkora`, `sovkora-tools`), a client platform (any B2B consumer), Krizaka Platform Kit
- **Enforced by:** `@verikora/core`, `@verikora/providers`, HTTP edge `X-Data-Residency-Zone`, 60-second zeroize RAM purge, Ed25519 attestation chain

## Context

Technologies Krizaka Inc. operates a House of Brands architecture with distinct product missions:
1. **Orasaka (`sovkora-engine`, `sovkora-tools`):** Sovereign enterprise AI platform running locally or on dedicated GPU hardware. `sovkora-tools` acts as an MCP gateway for generic, non-PII agent operations.
2. **Verikora (`krizaka/verikora`):** Elevated from an internal document analysis module to Krizaka’s 2nd flagship B2B commercial product. Verikora serves the Montreal/Quebec ecosystem (PropTech, FinTech, LegalTech, regulated platforms subject to **Quebec Law 25**) and global markets (PIPEDA, GDPR, CCPA).
3. **A client platform (any B2B consumer):** a platform that needs strict age gating, identity verification and contract vaulting, and must not hold identity documents itself.

### The Architectural Dilemma

- **Where do external KYC, Age Verification, and Credit connectors live?**
  - Should they live in `orasaka-tools` as generic MCP tools, or in Verikora?
- **How does a client platform consume these verification services?**
  - Should a client platform bypass Verikora and call Orasaka or third-party providers directly, or consume Verikora as "Customer Zero"?
- **How is legal sovereignty and data residency guaranteed across the call chain?**
  - How do we prevent sensitive PII, national ID scans, and biometric liveness photos from leaking into AI model inference layers, LLM logs, or uncertified cloud caches?

## Decision

### 1. Dedicated Trust SPI in Verikora (`@verikora/providers`)
- **Third-party connectors live exclusively within Verikora.** `orasaka-tools` remains strictly reserved for generic, stateless, non-PII agent tooling (e.g., search, arithmetic, format conversions).
- Verikora defines pluggable Service Provider Interfaces:
  - `IdvProvider` (Didit, Persona, Stripe Identity, Trulioo)
  - `AgeGateProvider` (Didit 18+ fast age verification)
  - `CreditBureauProvider` (Flinks Open Banking, CRS Credit API soft pulls)
- **Hard Invariant:** **NO raw PII, national ID images, or biometrics ever enter Orasaka or `orasaka-tools`.**

### 2. A client platform is "Customer Zero" of Verikora
- The client platform talks **only** to Verikora’s B2B API (`/api/v1/verifications/age`, `/api/v1/verifications/id`, `/api/v1/contracts`).
- The client platform stores **zero** identity documents, selfies, or biometric templates in its database.
- The client platform receives and stores only tamper-proof, Ed25519-signed cryptographic tokens (`VerificationAttestation`).
- Human escalation for unclear cases is surfaced directly via the client platform's own operator console, backed by Verikora audit receipts.

### 3. Multi-Region Data Residency & Quebec Law 25 Sovereignty
- Every request carries the mandatory context header `X-Data-Residency-Zone`:
  - `CA-QC`: Quebec / Canada (Physical residency at OVHcloud Beauharnois BHS or AWS Montreal `ca-central-1`).
  - `EU-CENTRAL`: European Union (Frankfurt / Paris - GDPR).
  - `US-EAST`: United States (Northern Virginia - CCPA / SOC2).
- **Stateless AI In-Memory Processing:** When Verikora invokes Orasaka Studios (`document-authenticity`, `compliance-check`), requests carry `Cache-Control: no-store` and operate solely in volatile memory (`tmpfs`). No disk persistence occurs on Orasaka.
- **Zero-Biometric-Retention by Default:** Raw document scans and liveness frames are purged and cryptographically wiped (DoD zeroize) within 60 seconds of verdict issuance.

## Provider Matrix & Unit Economics

| Provider | Capability | Unit Cost | Key Strengths & Fit |
| :--- | :--- | :--- | :--- |
| **Didit** | Age (18+) & Basic IDV | ~$0.30 / check (500 free/mo) | High speed (<15s), ultra-low unit cost; primary for 18+ age gating |
| **Persona** | Full KYC & AML | ~$1.50 - $2.00 / check | Premier Quebec document parsing (RAMQ, SAAQ); primary for high-risk B2B |
| **Stripe Identity** | Instant KYC | $1.50 / check | Native integration with creator payouts and Stripe Connect |
| **Flinks** | Open Banking & Solvency | ~$0.50 - $2.00 CAD / connection | Montreal-based open banking; real-time bank cash-flow for PropTech leasing |
| **CRS Credit API** | Soft Credit Bureau Pulls | ~$1.50 - $4.50 USD / pull | Instant tri-bureau soft pulls with zero score impact |
| **OVHcloud Beauharnois** | S3 & Dedicated Compute | ~$0.01 / GB / month | 100% physical Quebec jurisdiction without CLOUD Act exposure |

## Architecture Flow

```
┌─────────────────────────────────────────────────────────┐
│             A client platform (B2B consumer)            │
│   Front-end Creator & Consumer · "Customer Zero"       │
└───────────────────────────┬─────────────────────────────┘
                            │ B2B API (mTLS / Service Token)
                            ▼
┌─────────────────────────────────────────────────────────┐
│     VERIKORA (Sovereign Trust & Compliance Engine)      │
│  - /api/v1/verifications/{age,id}, /api/v1/contracts    │
│  - Multi-Region Router (X-Data-Residency-Zone: CA-QC)   │
│  - SPI: Didit, Persona, Flinks, CRS Credit             │
│  - 60s Biometric Zeroize Purge                          │
│  - Ed25519 Signed VerificationAttestation Ledger        │
└───────────────┬─────────────────────────┬───────────────┘
                │ Anonymized In-Memory    │ KMS Encrypted S3
                │ Cache-Control: no-store │ Regional Buckets
                ▼                         ▼
┌───────────────────────────────┐ ┌───────────────────────┐
│       ORASAKA AI ENGINE       │ │ KRIZAKA MULTI-REGION  │
│ - document-authenticity       │ │ • CA-QC (Beauharnois) │
│ - compliance-check (Loi 25)   │ │ • EU (Frankfurt)      │
│ - orasaka-tools (Generic MCP) │ │ • US (Virginia)       │
└───────────────────────────────┘ └───────────────────────┘
```

## Consequences & Trade-offs

- **Positive:** Complete isolation of PII guarantees compliance with Quebec Law 25 and GDPR.
- **Positive:** the client platform sheds direct liability by relying on signed cryptographic audit attestations.
- **Positive:** Verikora establishes commercial viability as a sovereign B2B trust product for Quebec PropTech and FinTech.
- **Negative / Operational Cost:** Multi-region S3 routing and per-zone KMS key rotation must be configured and monitored.

## Amendment (2026-10-28, verikora#130): what runs, and what does not

The text above is the target. This is what the code does today; the product claims only this.

- **Runs:** an uploaded document is **purged after its check** (file and text; the hash, the report and the audit row stay), unless the person consents to keep it (`lib/retention.ts`, ADR-0007); an identity document is never kept. The owner of a building receives only the redacted report by a link that expires (7 days by default, 30 at most) and can be revoked; each view is audited (`lib/owner-report-shares.ts`). The whole flow is proven by `lib/owner-flow.integration.test.ts`.
- **Runs:** documents kept by consent live in Canada (Spaces `tor1` or the workspace's own Canadian bucket); a store outside Canada is refused in production (`lib/env.ts`, `lib/storage/config.ts`).
- **Runs on the contracts API only:** the `X-Data-Residency-Zone` header (`CA` by default, a province allowed) is read and checked by `lib/contracts/zone.ts`.
- **Does not run:** the header on the document checks, the `EU-CENTRAL` / `US-EAST` zones, per-zone KMS keys, and the « 60-second zeroize »: the purge happens when the check ends (seconds to minutes, a database delete, not a cryptographic wipe). No page or message says otherwise.

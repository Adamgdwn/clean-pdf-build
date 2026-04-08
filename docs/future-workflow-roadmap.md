# Workflow Reference

## First-principles goals

- always show what the document is waiting on
- always show who needs to act next
- always give the initiator a clean update at meaningful stage changes
- always provide a safe path when a participant is blocked, wrong, or unavailable
- always make edits after partial completion understandable and auditable
- always close the loop with a clear completion package

---

## Current workflow diagram

```mermaid
flowchart TD

    %% ── ACCOUNT SETUP ──────────────────────────────────────────────────────
    subgraph ACCOUNT["① Account setup"]
        A1([Sign up]) --> A2[Onboarding prompt\nworkspace name · invite teammates]
        A2 --> A3[Owner Portal — Billing]
        A3 --> A4{Choose plan}
        A4 -->|no card required| A5[Free trial — 30 days\n$0 invoice emailed by Stripe]
        A4 --> A6[Monthly — $12 CAD per seat]
        A4 --> A7[Annual — $120 CAD per seat]
        A5 & A6 & A7 --> A8[Subscription active]
    end

    %% ── PREPARE DOCUMENT ────────────────────────────────────────────────────
    subgraph PREPARE["② Prepare document"]
        P1[Upload PDF] --> P2[Draft]
        P2 --> P3[Add participants\ninternal users · external signers]
        P3 --> P4[Place fields\nsignature · initial · approval · text · date]
        P4 --> P5[Assign fields to participants]
        P5 --> P6{Routing strategy}
        P6 -->|lowest stage + order first| P7[Sequential]
        P6 -->|all in stage at once| P8[Parallel]
        P7 & P8 --> P9{Delivery mode}
    end

    %% ── DELIVERY MODES ──────────────────────────────────────────────────────
    P9 -->|no platform emails\nowner distributes manually| D1[Self-managed]
    P9 -->|authenticated users only\nno external emails| D2[Internal-only]
    P9 -->|full email routing| D3[Platform-managed]

    D3 --> G1{Active subscription?}
    G1 -->|No| G2[402 — subscribe first]
    G1 -->|Yes| G3{Enough signing tokens\nfor external participants?}
    G3 -->|No| G4[402 — buy tokens\n$12 CAD for 12]
    G3 -->|Yes| SND

    D1 & D2 --> SND[Send\nsentAt recorded · version snapshot · audit event]

    %% ── ROUTING ─────────────────────────────────────────────────────────────
    SND --> R1[Determine eligible signers]
    R1 -->|Sequential| R2[Lowest stage, lowest signing order only\none signer active at a time per stage]
    R1 -->|Parallel| R3[All signers in lowest pending stage\nactive simultaneously]

    %% ── SIGNING ─────────────────────────────────────────────────────────────
    subgraph SIGN["③ Signing"]
        R2 & R3 --> S1{Signer type}

        S1 -->|EasyDraft account| S2[Internal signer\nauthenticated session]
        S1 -->|no account needed| S3[External signer\ntoken link delivered via email]

        S2 --> S4{Pre-placed field?}
        S4 -->|Yes| S5[Complete assigned field\nsaved signature · draw · type]
        S4 -->|No| S6[Free-placement\nposition and sign in one step\nany page, any size]
        S6 --> S5

        S3 --> S7[Guest signing session\nno account created\ntoken validated server-side]
        S7 --> S8[Complete assigned field\ndraw or type directly]

        S5 & S8 --> S9[Field complete\naudit event recorded\noriginator notified if enabled]
    end

    S9 --> CHK{All required assigned\naction fields complete?}
    CHK -->|No| NXT[Advance to next eligible signer\nnotify newly eligible participants]
    NXT --> S1
    CHK -->|Yes| C1

    %% ── COMPLETION AND EXPORT ────────────────────────────────────────────────
    subgraph COMPLETE["④ Completion and export"]
        C1[Completed\ncompletedAt set · document unlocked · audit event] --> C2[Render signed PDF\nembed all field values]
        C2 --> C3[SHA-256 hash computed\nstored on document record]
        C3 --> C4[Export available\nsigned PDF · completion certificate]
        C4 --> C5([Download via signed URL\n10-minute expiry])
    end

    %% ── OPERATIONAL PAUSES ───────────────────────────────────────────────────
    subgraph PAUSES["Operational pauses — available after Send"]
        L1[Locked\nno further signing\nowner/editor action]
        CR1[Changes requested\nworkflow paused\nsigner initiates · originator notified]
        X1([Rejected\nworkflow terminated\nsigner declines])
        X2([Canceled\nworkflow terminated\nowner/editor aborts])
    end

    SND -. owner/editor locks .-> L1
    L1 -. owner/editor reopens .-> R1
    S1 -. signer requests changes .-> CR1
    CR1 -. originator revises and reopens .-> R1
    S1 -. signer rejects .-> X1
    SND -. owner/editor cancels .-> X2

    %% ── AUDIT TRAIL ──────────────────────────────────────────────────────────
    SND & S9 & C1 & L1 & CR1 & X1 & X2 -.-> AT[(Audit trail\nfull event history\nvisible to all participants)]
```

---

## Document states

| State | Condition |
|---|---|
| `draft` | Uploaded; no fields placed yet |
| `prepared` | Fields placed but not sent |
| `sent` | `sentAt` set; no fields completed |
| `partially_signed` | At least one required field completed; not all |
| `completed` | All required assigned action fields complete |
| `reopened` | Previously locked or completed; reopened for further signing |

Operational pauses overlay any state: `changes_requested`, `rejected`, `canceled` block further signing without changing the base state.

---

## Delivery mode comparison

| Mode | Who gets emailed | Signing access | Token cost |
|---|---|---|---|
| Self-managed | Nobody | Internal users sign in; owner distributes links manually | None |
| Internal-only | Internal signers only | Authenticated EasyDraft users only | None |
| Platform-managed | All eligible signers | Internal users sign in; external signers use token link | 1 token per external workflow sent |

---

## Routing strategy comparison

| Strategy | Who signs when | Use case |
|---|---|---|
| Sequential | One signer at a time — lowest stage, lowest order first | Approval chains where order matters |
| Parallel | All signers in the current stage at once | Peer review, simultaneous approvals |

Stages can be combined: stage 1 parallel among three reviewers, stage 2 sequential for two final approvers.

---

## Field types

| Kind | Action field | Description |
|---|---|---|
| `signature` | Yes | Full signature — draw, type, or use saved signature |
| `initial` | Yes | Abbreviated signature — same options as signature |
| `approval` | Yes | Checkbox approval — no drawn signature required |
| `text` | No | Free-form text input |
| `date` | No | Date picker |

Only action fields (`signature`, `initial`, `approval`) count toward workflow completion. Text and date fields are informational.

---

## Permissions

| Role | Send | Lock/Reopen | Cancel | Sign fields | Buy tokens |
|---|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | — | ✓ |
| Editor | ✓ | ✓ | ✓ | — | — |
| Signer | — | — | — | ✓ (assigned only) | — |
| Viewer | — | — | — | — | — |

Owners and editors cannot sign their own fields. Signers cannot lock, reopen, or cancel.

---

## Future additions worth prioritising

These are not yet implemented. Add them when there is proven demand:

- **Certificate-backed PDF signing** — PAdES/CAdES embedding via `easy_draft_remote`, `qualified_remote`, or `organization_hsm` provider. The `DigitalSignatureProfile` model and UI already exist; only the provider wiring is missing.
- **Change-impact classification** — classify edits made after partial signing as `non_material`, `review_required`, or `resign_required` rather than treating all edits the same.
- **Purpose-built signer page** — replace the current sidebar layout for external signers with a focused signing experience that shows the document prominently with field highlights.
- **Stage-level originator updates** — send one email per stage completion rather than one per field to reduce notification noise on large documents.
- **Overdue escalation** — auto-reassign or auto-remind when a due date passes and the signer has not acted.

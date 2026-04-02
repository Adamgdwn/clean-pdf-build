# Future Workflow Roadmap

This roadmap keeps future workflow work straightforward and tied to the pains people actually feel in document flow.

## First-principles goals

- always show what the document is waiting on
- always show who needs to act next
- always give the initiator a clean update at meaningful stage changes
- always provide a safe path when a participant is blocked, wrong, or unavailable
- always make edits after partial completion understandable and auditable
- always close the loop with a clear completion package

## Future-state additions worth prioritizing

- explicit `waiting on` status
- simple due dates, reminders, and overdue status
- reassign or delegate participant
- request changes back to initiator
- cancel or void by initiator
- change-impact handling after partial completion
- final completion package with PDF, audit trail, summary, and export/share
- stage-level initiator updates instead of noisy updates for every tiny event

## Future-state Mermaid

```mermaid
flowchart TD
    A[Initiator creates or uploads document] --> B[Draft]
    B --> C[Prepare workflow]
    C --> C1[Set participants, routing, lock policy, due dates, and notifications]
    C1 --> D[Preview and send]
    D --> E[Sent]

    E --> U1[Update initiator: sent and waiting on first actor]
    U1 --> F[Active stage]
    F --> G[Show one clear blocker: who is next, what action is needed, and when it is due]

    G --> H{Participant action}

    H -- Complete --> I[Stage complete]
    I --> U2[Update initiator: stage complete]
    U2 --> J{More stages}

    J -- Yes --> K[Advance to next stage]
    K --> U3[Update initiator: waiting on next actor]
    U3 --> F

    J -- No --> L[All required stages complete]
    L --> M[Generate completion package]
    M --> M1[Final PDF, audit trail, completion summary, export or share]
    M1 --> U4[Update initiator: completed]
    U4 --> N[Archive and retain]

    H -- Request changes --> O[Return to initiator with comments]
    O --> U5[Update initiator: changes requested]
    U5 --> P[Initiator revises document]
    P --> Q{Change impact}

    Q -- No impact --> R[Keep prior completed stages valid]
    Q -- Review again --> S[Reopen affected stage]
    Q -- Re-approve or re-sign --> T[Invalidate affected stage]

    R --> U6[Update initiator: revised and resumed]
    S --> U6
    T --> U6
    U6 --> V[Resume from affected stage]
    V --> F

    G --> W{Due date reached}
    W -- No --> G
    W -- Yes --> X[Send reminder]
    X --> U7[Update initiator: overdue]
    U7 --> Y{Still blocked}

    Y -- No --> G
    Y -- Yes --> Z[Reassign or delegate participant]
    Z --> U8[Update initiator: reassigned]
    U8 --> F

    H -- Reject --> AA[Closed as rejected]
    AA --> U9[Update initiator: rejected]

    F --> AB{Initiator cancels}
    AB -- Yes --> AC[Voided by initiator]
    AB -- No --> G
    AC --> U10[Update initiator: canceled]
```

## Notes for implementation planning

- Keep the current core lifecycle simple: `draft`, `prepared`, `sent`, `partially_signed`, `completed`, `reopened`.
- Treat reject, changes requested, overdue, reassigned, canceled, and blocked states as operational statuses first.
- Keep routing as dimensions on one engine: participant type, routing strategy, stage, delivery mode, and lock policy.
- Prefer stage-level initiator updates over event spam.

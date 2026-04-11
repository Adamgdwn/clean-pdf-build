# Change-Impact Coverage

This note records the current post-sign mutation coverage in the workflow service so future edits can be checked against a concrete baseline instead of re-litigating whether change-impact enforcement exists.

## Current enforced paths

| Mutation path | Current consequence |
|---|---|
| Document rename | `non_material` version entry after signing starts |
| Workflow due date update | `non_material` version entry after signing starts |
| Add signer | `review_required` after signing starts |
| Reassign signer | `review_required` after signing starts |
| Routing strategy update | `review_required` after signing starts |
| Add field | Classified via field-set diff |
| Clear all fields | Classified via field-set diff |
| Undo editor state | Classified via snapshot diff |
| Redo editor state | Classified via snapshot diff |

## Current consequence rules

- `non_material`
  - audit/version only
  - no workflow pause or reset
- `review_required`
  - workflow moves to `changes_requested`
  - originator update is queued
  - reopen is required before more signing continues
- `resign_required`
  - completed action fields are cleared
  - workflow returns to active signing
  - originator and previously completed signers are notified

## Current scope boundary

The current system is focused on exposed mutation endpoints that can affect an in-flight or partially signed document. If new document-editing endpoints are added later, they must be added to this matrix and mapped explicitly to one of the existing impact outcomes.

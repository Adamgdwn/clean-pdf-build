# PDF Signature Rollout

This document tracks the current implementation status of EasyDraft's PDF-signature work and the concrete next steps required before treating it as production-ready.

## What shipped in code

The repository now includes all of the following:

- Supabase schema support for `documents.signature_path`, `documents.status`, `signature_events`, and `signature_path_config`
- split private storage buckets for unsigned and signed PDFs
- Path 1 PDF preparation with `pdf-lib`
- Path 1 internal signing with `@signpdf/signpdf` and a P12 certificate in `packages/workflow-service`
- Path 1 Vercel API routes:
  - `/api/signatures-internal-prepare`
  - `/api/signatures-internal-sign`
- Path 1 UI in the main workspace
- Path 2 Documenso envelope creation route:
  - `/api/documenso-envelope`
- Path 2 Documenso webhook route:
  - `/api/documenso-webhook`
- Path 2 embedded/internal signer UI panel plus status handling
- Path 3 stub only:
  - `/api/signatures-blockchain` returns `503`
  - disabled UI tile in the upload flow
- shared audit trail route:
  - `/api/signature-events`
- shared audit trail panel in the document workspace

## What still must happen outside code

These are the remaining rollout tasks for a live environment:

1. Apply the signature migration in hosted Supabase:
   - `supabase/migrations/20260422100000_pdf_signature_paths.sql`
2. Create and keep private these buckets:
   - `documents-unsigned`
   - `documents-signed`
   - `signatures`
3. Set the required Vercel environment variables:
   - `SUPABASE_UNSIGNED_DOCUMENT_BUCKET`
   - `SUPABASE_SIGNED_DOCUMENT_BUCKET`
   - `DOCUMENSO_API_BASE_URL`
   - `DOCUMENSO_API_KEY`
   - `DOCUMENSO_WEBHOOK_SECRET`
   - `P12_CERT_BASE64`
   - `P12_CERT_PASSPHRASE`
4. Configure a Documenso webhook pointing to:
   - `https://easydraftdocs.app/api/documenso-webhook`
5. Upload or provision the real Path 1 signing certificate:
   - PKCS#12 / `.p12`
   - base64-encode into `P12_CERT_BASE64`
   - set the matching `P12_CERT_PASSPHRASE`

## Recommended smoke test order

### Path 1

1. Upload a document with `Signature path = Path 1`
2. Add at least one signature field
3. Complete all required assigned fields
4. Click `Prepare PDF`
5. Click `Generate signed PDF`
6. Confirm the signed PDF downloads from `documents-signed`
7. Confirm `signature_events` includes `sent` and `signed` rows as expected

### Path 2

1. Upload a document with `Signature path = Path 2`
2. Add internal and external signers
3. Add action fields for those signers
4. Click `Create Documenso envelope`
5. Confirm:
   - the internal signer sees the embedded signing frame when applicable
   - the external signer receives the Documenso invite
   - webhook delivery updates `documents.status`
   - the completed Documenso PDF is copied into `documents-signed`
6. Confirm `signature_events` records `sent`, `viewed`, `signed`, and `rejected` when applicable

### Path 3

1. Confirm the upload selector shows Path 3 as disabled
2. Confirm `POST /api/signatures-blockchain` returns `503`
3. Confirm no blockchain logic is present in the service layer

## Known limits in the current build

- Path 2 relies on Documenso API and webhook configuration; without live credentials it cannot be verified end to end.
- Path 1 uses a local/server-managed P12 certificate and is intended for internal or trusted-organization workflows, not regulated qualified signatures.
- Path 3 is intentionally non-functional beyond the stub.

## Immediate next steps

1. Finish hosted env and bucket setup.
2. Run the Path 1 and Path 2 smoke tests in Preview.
3. Confirm the `signature_events` audit panel shows correct per-document history.
4. Verify purge/retention still removes signed artifacts for completed test documents.
5. Only then enable customer-facing messaging around the new signature paths.

# PDF Signature Storage

This project now uses separate private Supabase Storage buckets for unsigned source PDFs and finalized signed PDFs.

## Required buckets

Create these buckets in Supabase Storage and keep all of them private:

- `documents-unsigned`
- `documents-signed`
- `signatures`

`documents` may continue to exist for legacy exports and pre-split files, but new PDF-signature flows should use the two-bucket model above.

## Required environment variables

Set these values anywhere the Vercel Functions run:

- `SUPABASE_UNSIGNED_DOCUMENT_BUCKET=documents-unsigned`
- `SUPABASE_SIGNED_DOCUMENT_BUCKET=documents-signed`
- `SUPABASE_DOCUMENT_BUCKET=documents`
- `SUPABASE_SIGNATURE_BUCKET=signatures`

Set this client-side value for browser uploads:

- `VITE_SUPABASE_UNSIGNED_DOCUMENT_BUCKET=documents-unsigned`

The client should upload only to the unsigned bucket. Signed PDFs are written server-side only.

## Storage path convention

Use the existing per-user/per-document prefix:

- Unsigned source upload: `<user-id>/<document-id>/<original-file-name>.pdf`
- Path 1 prepared PDF: `<user-id>/<document-id>/internal/prepared.pdf`
- Path 1 final signed PDF: `<user-id>/<document-id>/internal/signed.pdf`
- Rendered export fallback: `<user-id>/<document-id>/exports/latest.pdf`

Path 2 should follow the same prefix strategy so purge and retention logic can remove all artifacts by document prefix across both buckets.

## Runtime rules

- Never expose a public permanent URL for any PDF.
- Always read documents through signed URLs generated server-side.
- Treat `documents-unsigned` as the working/source bucket.
- Treat `documents-signed` as the finalized signed-output bucket.
- Keep upload and delete logic bucket-aware because legacy records may still exist in `documents`.

## Operational checks

Before enabling PDF signature flows in an environment:

1. Confirm all three buckets are private.
2. Confirm browser uploads succeed into `documents-unsigned`.
3. Confirm signed PDFs are written only by server-side service-role code into `documents-signed`.
4. Confirm delete and retention jobs remove artifacts from `documents-unsigned`, `documents-signed`, and legacy `documents` paths for the document prefix.

-- Store the SHA-256 hash of the most-recently rendered export PDF.
-- Populated by renderDocumentExportToStorage() whenever a download is generated.
-- Allows the completion certificate to include a verifiable digest.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS export_sha256 text;

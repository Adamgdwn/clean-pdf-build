create unique index if not exists document_signers_document_id_lower_email_key
on public.document_signers (document_id, lower(email));;

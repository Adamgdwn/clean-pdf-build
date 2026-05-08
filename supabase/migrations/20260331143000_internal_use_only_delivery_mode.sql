do $$
begin
  alter type public.document_delivery_mode add value if not exists 'internal_use_only';
exception
  when duplicate_object then null;
end $$;;

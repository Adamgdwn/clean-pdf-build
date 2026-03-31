# Customer Pain Points

This product should feel like relief for teams that only need the common PDF workflow path, not a giant enterprise suite.

## Who we are serving first

- Operations coordinators who prepare the same kinds of forms over and over
- Small legal, finance, HR, and real-estate teams who need clear signer routing
- External signers who should not have to learn the tool to finish one task

## Current pain points we should design around

### 1. OCR is useful, but not trusted without visibility

Teams routinely work with scanned PDFs and image-heavy files. The biggest frustration is not just raw OCR accuracy, it is confidence in whether extracted content is safe to use without re-checking the whole document.

Product response:

- expose OCR status clearly
- store confidence and provenance per extraction job
- keep human review in the loop for low-confidence field suggestions

Research references:

- Adobe Acrobat OCR and scan-to-edit guidance: https://helpx.adobe.com/acrobat/using/edit-scanned-pdfs.html
- Customer discussion about OCR trust and manual re-checking: https://www.reddit.com/r/SaaS/comments/1s3gapx/is_anyone_actually_getting_reliable_results/

### 2. Auto field detection helps, but it is never fully hands-off

Existing tools promise automatic field creation, but real documents vary too much. Customers still need to move, delete, resize, or reassign detected fields quickly.

Product response:

- treat auto detection as a draft proposal, not final truth
- make manual correction extremely fast
- keep original and corrected field sets in audit history

Research references:

- Adobe form creation workflow and detection expectations: https://helpx.adobe.com/acrobat/using/creating-distributing-pdf-forms.html

### 3. Signing flow confusion creates support burden

People get blocked when they cannot tell who is next, which required fields remain incomplete, or whether a document is still open for signing. Competing tools often center on envelope completion instead of field-level completion.

Product response:

- show required-field completion by signer
- make routing mode explicit: sequential or parallel
- keep documents signable until all required assigned signing fields are complete or an explicit lock is recorded

Research references:

- DocuSign help flow showing required fields per recipient and sequential sending behavior: https://help.passageways.com/hc/en-us/articles/37106232493069-Docusign

### 4. “Simple” PDF tools often feel cluttered and expensive

For smaller teams, the pain is not missing edge-case features. It is paying for bulky software and then still fighting crowded interfaces for common tasks like rotate, delete, merge, assign, send, and export.

Product response:

- lead with task-focused screens
- avoid feature sprawl in v1
- make low-volume, role-based collaboration feel natural

Research references:

- Public review threads and community feedback consistently point to pricing friction and UI complexity across incumbent PDF suites and e-sign tools

## Product guardrails

- No “AI assistant” surface in v1
- No desktop-publishing aspirations
- No hidden completion logic
- No silent destructive transforms
- Every major action generates an audit event

---
name: Altınbaş adapter (Screen Flow replay)
description: Salesforce Screen Flow portal — adapter replays navigateFlow aura POSTs (serializedState chained) instead of DOM clicking; closed LWC shadow makes UI automation impossible past Program screen.
---

## Architecture decision (Faz-4, 2026-07-10) — navigateFlow REPLAY

The wizard is a Salesforce Screen Flow. Every screen transition is
`POST /partner/s/sfsites/aura` → `FlowRuntimeConnectController.navigateFlow`
with `{action: NEXT|CONTINUE_AFTER_COMMIT|FINISH, serializedState, fields[]}`.
- `serializedState` is ~90KB ENCRYPTED + server-chained → can NEVER be hand-built;
  always take it from the LAST flow response. Adapter must run in a live logged-in
  browser (flow boot via clicking "Create New Application" gives the first state
  carrying applicant context).
- `fields[]` is PLAIN TEXT → we inject our values by field name; Next is never
  clicked, so client-side validation never runs.

**Why**: the program cards live inside CLOSED LWC shadow DOM — no Playwright
locator or evaluate-walker can reach them (proven empirically over many dry-runs).
The earlier coordinate-click approach worked but was fragile; replay removes all
DOM interaction past Step 1. Do NOT reintroduce DOM/coordinate handling for
Term→FINISH screens.

## Flow contract essentials (captured live)

- Screen order: Term(NEXT) → Degree(NEXT) → Program(NEXT) →
  CONTINUE_AFTER_COMMIT ×N with `fields:[]` (application record is CREATED here)
  → Personal(NEXT) → Educational(NEXT) → Questionnaire(NEXT) → Documents(NEXT)
  → FINISH. Dry-run stops before FINISH.
- Formats: dates ISO `YYYY-MM-DD` (UI shows otherwise — payload is ISO);
  country picklists are a 3-field pattern
  (`<F>.<Group>.<CountryEn>.selected=true` + `.selectedChoiceLabels/Values`;
  Passport_Issuing_Country's group is `IssuingCountry`, others `CountryList`);
  phone = `phoneWithCountryCode.selectedCountryCode` + `.phone` with the dial
  code PREFIXED; Email is READ-ONLY pre-filled — never send it.
- Record ids in responses: Term/Degree options prefix `a0C`, program
  availability `a0A` (carries `eduhub__Program__c`), Contact `003`,
  Application__c `a02`, Account `001`. Eligible program list is client-side
  preloaded; already-applied programs are hidden from it.
- Duplicate guard: portal blocks a 2nd application with same
  passport+term+degree (`Prevent_Duplicate_Passport` subflow) → adapter maps it
  to alreadyExists=true (SKIPPED_DUPLICATE), never a FAIL.

## Hardening rules (architect-reviewed)

- Interceptor ingests state/template ONLY from FlowRuntimeConnectController
  traffic (background aura calls would corrupt the chained state); the
  ALTINBAS_CAPTURE=1 dump still logs ALL aura traffic (/tmp/altinbas-capture.json).
- A replay response counts only if HTTP 2xx AND parses as aura JSON with
  `actions[]`; FINISH additionally requires `state:SUCCESS` before
  submitted=true (HTML login/edge pages must fail visibly, never fake success).

## State chaining (FIX-4, 2026-07-10) — response key is DIFFERENT

- Flow RESPONSES return the new state under `serializedEncodedState`;
  `serializedState` is the REQUEST-side key. Ingest must accept both
  (encoded preferred when an object carries both) or the chain silently
  sticks on the tiny (~3KB) boot-request state and the flow rejects the
  2nd NEXT with interviewStatus:"Error" even when field data is correct.
- Real interview state is tens of thousands of chars — a <5KB state before
  send is a broken-chain signal (WARN); log newStateLen after every ingest.
- interviewStatus:"Error" is a flow-error signal alongside state:ERROR /
  exceptionEvent / errors[] (match escaped-JSON variants too).

## Option matching (FIX-2/FIX-3, 2026-07-10)

- Term/Degree/Program selectable options come from the navigateFlow RESPONSE
  records themselves (boot carried 11) — there is NO separate Apex options call.
  Never send a screen with `fields:[]` (nf=0): the flow silently advances with
  no selection and the NEXT screen fails ("Degree seçeneği bulunamadı").
- FIX-3 lesson: loose label-only dynamic parse picks the WRONG record type —
  year-only "2026-2027" labels live on a02 (application/availability) records
  and the flow REJECTS them (interviewStatus:"Error"). Dynamic candidates MUST
  be filtered by Id prefix AND label pattern (Term: a0C + season word; Degree:
  a0C + Master/PhD/Doctorate/Doktora; Program: a0A/a0B/eduhub__Program__c).
- Captured constants are PRIMARY for Term+Master (this cycle stable):
  Term "Fall 2026 - 2027"→a0CQ30000AVvpaEMQR, Degree "Master"→a0CQ30000AVvqKTMQZ;
  PhD Id unknown → filtered dynamic, else fail-visible (capture on a PhD run).
- Term fields must include `TermSelector.maxSelections=3` + `uniMaxSelection=3`.
- On flow ERROR at a selection screen, log the exact sent id+label.

## Still unknown (pending first live ALTINBAS_CAPTURE=1 run)

- FINISH exact payload and Documents upload (Salesforce ContentVersion base64
  insert) were never captured — Documents is currently passed empty and the
  capture dump exists precisely to grab these on the first real run.
- Questionnaire required answers shape (`QuestionnaireView.responseQuestions`);
  known question: "Do you need Visa Support?" → Yes.

## Kept DOM parts (before the flow boots)

- Level guard: Master/PhD only, everything else → skipped with clear detail
  (customer confirmed only Master+PhD open).
- Login → Basic Info Step 1 (First/Last/Citizenship typeahead/Passport/Email) →
  student grid (SLDS faux radio needs force-check) → applicant detail →
  "Create New Application". SPA route guard bounces cold deep-links → click-through
  navigation with retries; "Sorry to interrupt" CSS-error dialog dismissed
  non-blockingly.
- Live success verification (portal UI): Applications list Stage "Evaluation"
  + green ✓; "Signed Up"/"Complete Application" = half-finished.

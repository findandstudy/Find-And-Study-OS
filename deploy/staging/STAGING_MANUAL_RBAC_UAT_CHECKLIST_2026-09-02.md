# Staging manual RBAC visual UAT checklist — 2 September 2026

This checklist is the human-operated visual acceptance layer for the isolated
synthetic staging environment. It does not replace the exact-release API RBAC
runner, which already passed `126` checks across `11` roles.

## Fixed target

- Origin: `https://staging.findandstudy.com`
- Login: `https://staging.findandstudy.com/tr/login`
- Temporary rollback origin: `https://staging.srv1110168.hstgr.cloud`
- Deployed commit: `ffc7f8d0f54b8becff3162410e86f5942e3c55a8`
- Release ID: `staging-20260902T123142Z-ffc7f8d0f54b`
- Expected database ledger: `83/83`
- Expected synthetic denominator: 12 users, including 11 RBAC UAT users, two
  UAT agent profiles and one UAT student profile

Stop if `/api/health` does not report `dbConnected=true` and the exact release
ID above. Do not continue against a different origin, release or database.

## Safety boundary

- Use only the fixed `@audit.test` identities below.
- The common UAT password remains host-only at
  `/opt/findandstudy-staging/secrets/rbac-uat-password`. An authorized operator
  may read it locally on the staging VPS; never paste it into Git, a ticket,
  chat, screenshot, recording or test report.
- Do not send messages or email, submit applications, run portal automation,
  create payments, mutate roles, upload files, or delete data.
- Use one browser session at a time. Log out before changing roles; if logout
  fails, stop instead of reusing the session.
- Screenshots may contain only synthetic UAT data and must not include the
  password, cookies, tokens or browser developer-tool storage views.

## Shared login and logout checks

For each identity in the table:

1. Open `/tr/login` and confirm that email and password inputs have visible
   labels and the submit button has a visible Turkish login label.
2. Reach the password visibility control by keyboard. Confirm it has a
   meaningful accessible name, toggles visibility, and exposes pressed state.
3. Sign in with the role's synthetic email and the host-only common password.
4. Confirm the expected landing path, visible role label, stable navigation and
   absence of a reload/error boundary.
5. Confirm that no forbidden area or another role's private navigation appears.
6. Log out and confirm return to a login page before testing the next identity.

| Role | Synthetic email | Expected landing path |
| --- | --- | --- |
| Super Admin | `audit-superadmin@audit.test` | `/admin/dashboard` |
| Admin | `audit-admin@audit.test` | `/admin/dashboard` |
| Manager | `audit-manager@audit.test` | `/admin/dashboard` |
| Staff | `audit-staff@audit.test` | `/staff/dashboard` |
| Consultant | `audit-consultant@audit.test` | `/staff/dashboard` |
| Editor | `audit-editor@audit.test` | `/staff/dashboard` |
| Accountant | `audit-accountant@audit.test` | `/staff/dashboard` |
| Agent | `audit-agent@audit.test` | `/agent` |
| Sub-agent | `audit-subagent@audit.test` | `/agent` |
| Agent Staff | `audit-agentstaff@audit.test` | `/agent` |
| Student | `audit-student@audit.test` | `/student` |

## Exact visual route checks

These checks mirror the UI assertions registered in
`artifacts/edcons/tests/e2e/rbac-functional.spec.ts`.

| ID | Identity | Direct path | Expected visual result |
| --- | --- | --- | --- |
| V-01 | Accountant | `/staff/finance` | Finance page remains open; no reload/error boundary. |
| V-02 | Staff | `/staff/finance` | Redirected away; no finance data flashes before redirect. |
| V-03 | Admin | `/admin/ai-personas` | AI personas page opens; no reload/error boundary. |
| V-04 | Staff | `/admin/ai-personas` | Redirected away; no AI configuration flashes. |
| V-05 | Staff | `/staff/messages` | Messages page opens without a reload/error boundary; do not send. |
| V-06 | Admin | `/staff/students` | Student list shell opens without a reload/error boundary. |
| V-07 | Student | `/student/applications` | Student application view opens without a reload/error boundary. |
| V-08 | Agent | `/agent` | Agent dashboard opens without a reload/error boundary. |
| V-09 | Sub-agent | `/agent` | Agent-scoped dashboard opens without a reload/error boundary. |
| V-10 | Agent Staff | `/agent` | Permission-scoped agent dashboard opens without a reload/error boundary. |

For deny cases, the acceptance signal is the final route and absence of
forbidden content. A transient page title or navigation label is not sufficient
if protected records or settings render.

## Responsive and accessibility spot checks

Repeat the login screen and one allowed dashboard at approximately `390 × 844`
and `1440 × 900`:

- no horizontal page overflow;
- focused controls remain visible;
- keyboard focus order follows the visual order;
- the password toggle and submit control remain reachable;
- sidebar/menu can be opened and closed without trapping focus;
- loading and empty states do not resemble an application failure.

## Acceptance record

Executed result (aggregate, non-secret evidence only):

```text
Target release: staging-20260902T123142Z-ffc7f8d0f54b
Browser and version: Codex in-app browser (engine version not exposed)
Desktop result: PASS
Mobile result: PASS (390 x 844; viewport override reset afterward)
Role landing checks: 11 / 11 PASS
Exact visual route checks: 10 / 10 PASS
Accessibility spot checks: PASS
Failure IDs and redacted notes: none
Operator: Codex, under explicit project-owner approval
UTC timestamp: 2026-09-02T14:07:13Z
```

The two deny checks (`Staff → /staff/finance` and
`Staff → /admin/ai-personas`) redirected to the public `/en` route without a
protected heading, horizontal overflow or application error. The eight allow
checks retained their exact protected routes. Mobile spot checks covered the
login form, Student dashboard/applications, Agent dashboard and Staff
dashboard/messages. Every checked page exposed a named sidebar toggle and no
horizontal overflow. The password visibility control changed its accessible
name and `aria-pressed` state together (`false → true → false`) while the input
type changed `password → text → password`.

Any wrong landing path, visible forbidden data, unexpected mutation control,
reload/error boundary, session crossover, or release mismatch is a failed gate.
Do not approve production adoption from this checklist; production remains a
separate NO-GO decision.

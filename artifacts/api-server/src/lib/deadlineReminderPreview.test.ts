import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSyntheticDeadlinePreview, reminderScheduleFingerprint } from "./deadlineReminderPreview";

describe("deadline reminder preview", () => {
  it("only allows incomplete explicitly interested and consented candidates", () => {
    const rows = buildSyntheticDeadlinePreview();
    assert.deepEqual(rows.filter(row => row.eligible).map(row => row.reference), [
      "SYN-ELIGIBLE-EMAIL",
      "SYN-ELIGIBLE-WHATSAPP",
    ]);
    assert.equal(rows.find(row => row.reference === "SYN-COMPLETED")?.reason, "APPLICATION_COMPLETED");
    assert.equal(rows.find(row => row.reference === "SYN-NO-CONSENT")?.reason, "CONSENT_MISSING");
    assert.equal(rows.find(row => row.reference === "SYN-UNSUBSCRIBED")?.reason, "UNSUBSCRIBED");
    assert.equal(rows.find(row => row.reference === "SYN-RECENT")?.reason, "RECENT_REMINDER");
  });

  it("changes the schedule fingerprint when the deadline changes", () => {
    const a = reminderScheduleFingerprint({ periodId: 1, deadline: "2027-03-11", timezone: "Europe/Warsaw", daysBefore: 30 });
    const b = reminderScheduleFingerprint({ periodId: 1, deadline: "2027-03-12", timezone: "Europe/Warsaw", daysBefore: 30 });
    assert.notEqual(a, b);
  });
});

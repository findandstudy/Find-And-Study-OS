import assert from "node:assert/strict";
import test from "node:test";
import { registrationIdentitySchema } from "../src/lib/registrationIdentitySchema";

const valid = {
  email: "  Student@Example.COM ",
  password: "Correct Horse Battery Staple 42!",
  firstName: " Ada ",
  lastName: " Lovelace ",
  phone: " +905551112233 ",
  matchingProfile: { targetEducationLevel: "Bachelor" },
};

test("registration identity normalizes bounded valid input without dropping the profile", () => {
  const parsed = registrationIdentitySchema.parse(valid);
  assert.equal(parsed.email, "student@example.com");
  assert.equal(parsed.firstName, "Ada");
  assert.equal(parsed.lastName, "Lovelace");
  assert.equal(parsed.phone, "+905551112233");
  assert.deepEqual(parsed.matchingProfile, valid.matchingProfile);
});

test("registration identity rejects malformed email before database or mail work", () => {
  const result = registrationIdentitySchema.safeParse({ ...valid, email: "not-an-email" });
  assert.equal(result.success, false);
});

test("registration identity rejects empty or oversized names, passwords and phones", () => {
  for (const candidate of [
    { ...valid, firstName: " " },
    { ...valid, lastName: "x".repeat(121) },
    { ...valid, password: "x".repeat(257) },
    { ...valid, phone: "1".repeat(41) },
  ]) {
    assert.equal(registrationIdentitySchema.safeParse(candidate).success, false);
  }
});

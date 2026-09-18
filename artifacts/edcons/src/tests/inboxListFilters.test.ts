import test from "node:test";
import assert from "node:assert/strict";
import { inboxListFilters } from "../lib/inboxListFilters";

const base = { tab: "all", channel: "all", order: "desc", showTests: false, search: "", assignedToId: null, channelAccountId: "", cursor: null };
test("status, person, channel and receiving account combine across pagination", () => {
  for (const tab of ["open", "unread", "unanswered", "awaiting", "archived"]) {
    for (const channel of ["whatsapp", "instagram"]) {
      const params = inboxListFilters({ ...base, tab, channel, assignedToId: 42, channelAccountId: "7", cursor: "page2" });
      assert.equal(params.get("tab"), tab);
      assert.equal(params.get("assignedToId"), "42");
      assert.equal(params.get("channelAccountId"), "7");
      assert.equal(params.get("channel"), channel);
      assert.equal(params.get("cursor"), "page2");
    }
  }
});
test("all accounts and legacy/unlinked account are distinct", () => {
  assert.equal(inboxListFilters(base).has("channelAccountId"), false);
  assert.equal(inboxListFilters({ ...base, channelAccountId: "0" }).get("channelAccountId"), "0");
});
test("search is encoded without injecting a different assignment or account", () => {
  const params = inboxListFilters({ ...base, search: "a&assignedToId=99", assignedToId: 42 });
  assert.equal(new URLSearchParams(params.toString()).get("assignedToId"), "42");
  assert.equal(params.get("search"), "a&assignedToId=99");
});

test("mine and unassigned are person filters, independent of unread/open status", () => {
  for (const assignment of ["mine", "unassigned"] as const) {
    for (const tab of ["unread", "open"]) {
      const params = inboxListFilters({ ...base, assignment, tab });
      assert.equal(params.get("assignment"), assignment);
      assert.equal(params.get("tab"), tab);
      assert.equal(params.has("assignedToId"), false);
    }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { whilePageVisible } from "../src/lib/visibleSubscription";

test("development lease yields connections and cannot reconnect after disposal", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  let opened = 0,
    closed = 0;
  const dispose = whilePageVisible(
    () => {
      opened++;
      return () => {
        closed++;
      };
    },
    page,
    15_000,
  );
  assert.equal(opened, 1);
  t.mock.timers.tick(15_000);
  assert.equal(closed, 1);
  t.mock.timers.tick(1000);
  assert.equal(opened, 2);
  dispose();
  t.mock.timers.tick(60_000);
  assert.equal(opened, 2);
  assert.equal(closed, 2);
});

test("hidden tabs release streams; returning reconnects once; unmount removes listeners", () => {
  const events = new EventTarget();
  const page = Object.assign(events, {
    visibilityState: "hidden" as DocumentVisibilityState,
  });
  let opened = 0,
    closed = 0;
  const dispose = whilePageVisible(() => {
    opened++;
    return () => {
      closed++;
    };
  }, page);
  assert.equal(opened, 0);
  const visibility = (state: DocumentVisibilityState) => {
    page.visibilityState = state;
    page.dispatchEvent(new Event("visibilitychange"));
  };
  visibility("visible");
  visibility("visible");
  assert.equal(opened, 1);
  visibility("hidden");
  visibility("hidden");
  assert.equal(closed, 1);
  visibility("visible");
  assert.equal(opened, 2);
  dispose();
  dispose();
  visibility("hidden");
  visibility("visible");
  assert.equal(opened, 2);
  assert.equal(closed, 2);
});

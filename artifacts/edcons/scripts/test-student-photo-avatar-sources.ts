import assert from "node:assert/strict";
import { test } from "node:test";
import { studentPhotoSources } from "../src/lib/studentPhotoSources";

test("lists and details prefer the guarded thumbnail and retain a protected PDF source", () => {
  assert.deepEqual(studentPhotoSources({ base: "", studentId: 7, hasPhoto: true }), {
    images: ["/api/students/7/photo/thumbnail?fallback=source"],
    pdf: "/api/students/7/photo",
  });
  assert.deepEqual(studentPhotoSources({ base: "/portal", studentId: 7, revision: 3 }), {
    images: ["/portal/api/students/7/photo/thumbnail?v=3&fallback=source"],
    pdf: "/portal/api/students/7/photo?v=3",
  });
});

test("an old signed thumbnail opts in and its signed source stays on the same student", () => {
  const result = studentPhotoSources({
    base: "", studentId: 7, photoUrl: "/api/students/7/photo/thumbnail?exp=123&sig=abcdef",
  });
  assert.deepEqual(result.images, [
    "/api/students/7/photo/thumbnail?fallback=source",
    "/api/students/7/photo/thumbnail?exp=123&sig=abcdef&fallback=source",
  ]);
  assert.equal(result.pdf, "/api/students/7/photo?exp=123&sig=abcdef");

  const sourceOnly = studentPhotoSources({
    base: "", studentId: 7, photoUrl: "/api/students/7/photo?exp=123&sig=abcdef",
  });
  assert.equal(sourceOnly.images[1], sourceOnly.pdf);
});

test("missing photos need no HTTP requests; file URLs never become PDF fetch targets", () => {
  assert.deepEqual(studentPhotoSources({ base: "", studentId: 7, hasPhoto: false }), {
    images: [], pdf: null,
  });
  const result = studentPhotoSources({
    base: "", studentId: 7, photoUrl: "https://assets.example.invalid/profile.jpg",
  });
  assert.equal(result.images[1], "https://assets.example.invalid/profile.jpg");
  assert.equal(result.pdf, "/api/students/7/photo");
  assert.equal(studentPhotoSources({ base: "", studentId: 7, photoUrl: "/api/students/8/photo?exp=123&sig=abcdef" }).images.length, 1);
  assert.deepEqual(studentPhotoSources({ base: "", photoUrl: "data:image/png;base64,invalid" }), {
    images: [], pdf: null,
  });
});

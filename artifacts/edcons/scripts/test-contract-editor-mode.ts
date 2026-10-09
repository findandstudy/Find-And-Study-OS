import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContractRichTextEditor } from "../src/components/contracts/ContractRichTextEditor";
import { requiresContractHtmlEditing } from "../src/components/contracts/contractEditorMode";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { JSDOM } = requireApi("jsdom");
// The direct tsx test runner uses classic JSX; the Vite application uses automatic JSX.
(globalThis as any).React = React;

function inspectEditor(value: string, disabled = false) {
  const changes: string[] = [];
  const html = renderToStaticMarkup(React.createElement(ContractRichTextEditor, {
    value, disabled, onChange: (next: string) => changes.push(next),
  }));
  return { dom: new JSDOM(html), changes };
}

test("simple paragraphs and lists retain visual editing", () => {
  const value = "<h1>Agreement</h1><p>Hello <strong>{{name}}</strong></p><ul><li>Term</li></ul>";
  assert.equal(requiresContractHtmlEditing(value), false);
  const { dom, changes } = inspectEditor(value);
  try {
    assert.ok(dom.window.document.querySelector('[contenteditable="true"]'));
    assert.equal(dom.window.document.querySelector("textarea"), null);
    assert.deepEqual(changes, []);
  } finally { dom.window.close(); }
});

for (const [name, value] of Object.entries({
  "leading style": '<style>.title{color:#143591}</style><h1 class="title">{{name}}</h1>',
  "full document": '<!doctype html><html lang="ar" dir="rtl"><head><style>p{color:blue}</style></head><body><p>{{name}}</p></body></html>',
  "table layout": '<table><tr><td>{{name}}</td><td>Signature</td></tr></table>',
  "inline layout": '<p style="display:flex;gap:12px">{{name}}</p>',
  "nested layout": '<div><p>{{name}}</p><img src="{{signature}}"></div>',
})) {
  test(`${name} opens as unchanged, inert HTML with visual conversion disabled`, () => {
    assert.equal(requiresContractHtmlEditing(value), true);
    const { dom, changes } = inspectEditor(value);
    try {
      const document = dom.window.document as Document;
      assert.equal(document.querySelector("textarea")?.value, value);
      assert.equal(document.querySelector("[contenteditable]"), null);
      assert.equal(document.querySelector("style"), null);
      const visual = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Visual");
      assert.equal(visual?.disabled, true);
      assert.match(document.getElementById(visual?.getAttribute("aria-describedby") || "")?.textContent || "", /preserve the design/);
      assert.deepEqual(changes, []);
    } finally { dom.window.close(); }
  });
}

test("published designed HTML stays disabled and malicious source is never inserted as DOM", () => {
  const value = '<style>.x{color:red}</style><script>alert(1)</script><img src=x onerror="alert(1)"><p>{{name}}</p>';
  const { dom, changes } = inspectEditor(value, true);
  try {
    assert.equal(dom.window.document.querySelector("textarea")?.value, value);
    assert.equal(dom.window.document.querySelector("textarea")?.disabled, true);
    assert.equal(dom.window.document.querySelectorAll("style,script,img,[onerror]").length, 0);
    assert.deepEqual(changes, []);
  } finally { dom.window.close(); }
});

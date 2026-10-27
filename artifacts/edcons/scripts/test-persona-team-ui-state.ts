import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { JSDOM } = requireApi("jsdom");
const { build } = requireApi("esbuild");
const requireHere = createRequire(import.meta.url);
const project = "019a45ab-0000-7000-8000-000000000001";
const path = `/api/persona-workspace/${project}/team-workspace`;

// Render the real components and Radix sheet in memory. Only app-wide session
// and language hooks are substituted; all data calls use a synthetic fetch.
const bundled = await build({
  stdin: {
    contents: `export { createElement, act } from "react";
      export { createRoot } from "react-dom/client";
      export { default as Designer } from "./src/pages/admin/TeamDesigner";
      export { default as Tasks } from "./src/pages/admin/TeamWorkspaceTasks";
      export { workspaceFromTemplate } from "./src/lib/personaTeamWorkspace";
      export { socialMockTeamTemplate as template } from "../api-server/src/lib/personaTeamDraft";`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "tsx",
  },
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  write: false,
  loader: { ".css": "empty" },
  plugins: [{
    name: "synthetic-app-context",
    setup(plugin: any) {
      plugin.onResolve({ filter: /^@\/hooks\/use-(auth|i18n|mobile)$/ }, (args: any) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ contents:
        args.path.endsWith("use-auth") ? `export const useAuth=()=>({user:{id:1,role:"super_admin"}});` :
        args.path.endsWith("use-i18n") ? `export const useI18n=()=>({lang:"tr",dir:"ltr"});` :
        `export const useIsMobile=()=>window.innerWidth<768;`, loader: "js" }));
    },
  }],
});

function harness(width = 900) {
  const dom = new JSDOM("<!doctype html><body><main id='root'></main></body>", { url: "http://localhost/", pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win, "innerWidth", { value: width, configurable: true });
  const mediaListeners = new Set<(event: { matches: boolean }) => void>();
  win.matchMedia = (query: string) => ({ matches: query.includes("1099") && width < 1100, media: query,
    addEventListener(_type: string, listener: (event: { matches: boolean }) => void) { mediaListeners.add(listener); },
    removeEventListener(_type: string, listener: (event: { matches: boolean }) => void) { mediaListeners.delete(listener); },
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (name: string, value: unknown) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "KeyboardEvent", "FocusEvent", "getComputedStyle"]) {
    set(name, name === "window" ? win : typeof win[name] === "function" && name === "getComputedStyle" ? win[name].bind(win) : win[name]);
  }
  set("requestAnimationFrame", win.requestAnimationFrame.bind(win));
  set("cancelAnimationFrame", win.cancelAnimationFrame.bind(win));
  set("ResizeObserver", class { observe() {} disconnect() {} });
  set("IS_REACT_ACT_ENVIRONMENT", true);
  const NativeMessageChannel = globalThis.MessageChannel;
  const channels: MessageChannel[] = [];
  set("MessageChannel", class {
    port1; port2;
    constructor() {
      const channel = new NativeMessageChannel();
      channels.push(channel);
      this.port1 = channel.port1; this.port2 = channel.port2;
    }
  });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(requireHere, module, module.exports);
  const ui = module.exports;
  const root = ui.createRoot(win.document.getElementById("root"));
  return {
    dom, win, ui, root, set,
    async render(component: any, props: any) {
      await ui.act(async () => { root.render(ui.createElement(component, props)); });
    },
    async flush() { await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); },
    async resize(next: number) {
      await ui.act(async () => {
        width = next;
        Object.defineProperty(win, "innerWidth", { value: width, configurable: true });
        for (const listener of mediaListeners) listener({ matches: width < 1100 });
      });
    },
    async close() {
      await ui.act(async () => { root.unmount(); });
      // Radix restores focus on its deferred unmount tick. Keep this DOM's
      // Event constructors installed until that cleanup has completed.
      await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      dom.window.close();
      for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
      for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
    },
  };
}

test("saving and refreshing the workspace retain task text and exact installed selection without submitting", async () => {
  const h = harness();
  try {
    const document = structuredClone(h.ui.template);
    const teamId = "019a45ab-0000-7000-8000-000000000002";
    const drafts = [{ action_id: 71, document, digest: "a".repeat(64), maker: "maker", reviewer: "reviewer" }];
    const teams = document.members.map((member: any, index: number) => ({ id: teamId, draft_id: 71, status: "MOCK_READY", document, member_key: member.key, parent_key: member.parent, persona_id: 100 + index }));
    const calls: string[] = [];
    h.win.document.cookie = `csrf_token=${"c".repeat(64)}`;
    h.set("fetch", async (url: string, options: RequestInit) => {
      assert.equal(options.method, "GET", "Saving the graph must not submit a task");
      calls.push(url);
      const data = url.endsWith("/teams") ? teams : url.endsWith("/team-drafts") ? drafts : [];
      return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    });
    await h.render(h.ui.Tasks, { path, disabled: false, refreshVersion: 0 });
    await h.flush();
    const team = h.win.document.getElementById("tasks-team");
    const member = h.win.document.getElementById("tasks-member");
    const brief = h.win.document.getElementById("tasks-brief");
    team.value = teamId; team.dispatchEvent(new h.win.Event("change"));
    member.value = "102"; member.dispatchEvent(new h.win.Event("change"));
    brief.value = "Henüz gönderilmemiş sentetik görev"; brief.dispatchEvent(new h.win.Event("input"));
    const before = calls.length;
    await h.render(h.ui.Tasks, { path, disabled: true, refreshVersion: 0 });
    assert.equal(h.win.document.getElementById("tasks-brief"), brief);
    assert.equal(brief.value, "Henüz gönderilmemiş sentetik görev");
    assert.equal(h.win.document.querySelector("fieldset").disabled, true);
    h.win.document.getElementById("tasks-propose").click();
    assert.equal(calls.length, before);
    await h.render(h.ui.Tasks, { path, disabled: false, refreshVersion: 0 });
    await h.flush();
    assert.equal(brief.value, "Henüz gönderilmemiş sentetik görev");
    assert.equal(team.value, teamId); assert.equal(member.value, "102");
    await h.render(h.ui.Tasks, { path, disabled: false, refreshVersion: 1 });
    await h.flush();
    assert.equal(h.win.document.getElementById("tasks-brief"), brief);
    assert.equal(brief.value, "Henüz gönderilmemiş sentetik görev");
    assert.equal(team.value, teamId); assert.equal(member.value, "102");
    await h.render(h.ui.Tasks, { path: path.replace(project, "019a45ab-0000-7000-8000-000000000003"), disabled: false, refreshVersion: 1 });
    await h.flush();
    assert.equal(h.win.document.getElementById("tasks-brief").value, "", "A different project's input must not carry across");
  } finally { await h.close(); }
});

test("compact member editor keeps pending fields on close and connection attempts until Apply", async () => {
  const h = harness(900);
  let pending = false;
  let latest: any;
  try {
    await h.render(h.ui.Designer, { initialState: h.ui.workspaceFromTemplate(h.ui.template), onChange: (value: any) => { latest = value; }, onPendingChange: (value: boolean) => { pending = value; } });
    await h.ui.act(async () => { h.win.document.querySelector('[data-testid="team-node-research"]').click(); });
    const field = h.win.document.getElementById("team-member-name");
    assert.ok(field);
    await h.ui.act(async () => {
      Object.getOwnPropertyDescriptor(h.win.HTMLInputElement.prototype, "value")!.set!.call(field, "Korunacak uzman adı");
      field.dispatchEvent(new h.win.Event("input", { bubbles: true }));
    });
    assert.equal(pending, true);
    const findButton = (label: string) => [...h.win.document.querySelectorAll('[role="dialog"] button')].find((button: any) => button.textContent.trim() === label) as any;
    await h.ui.act(async () => { findButton("Close").click(); });
    assert.equal(h.win.document.getElementById("team-member-name"), field);
    assert.equal(field.value, "Korunacak uzman adı");
    assert.equal(pending, true);
    await h.resize(1200);
    assert.equal(h.win.document.getElementById("team-member-name"), field, "Breakpoint changes must not unmount the pending sheet");
    await h.ui.act(async () => { findButton("Bağlantı değiştir").click(); });
    assert.equal(h.win.document.getElementById("team-member-name"), field);
    assert.equal(field.value, "Korunacak uzman adı");
    await h.ui.act(async () => { field.closest("form").dispatchEvent(new h.win.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(pending, false);
    assert.equal(latest.document.members.find((member: any) => member.key === "research").name, "Korunacak uzman adı");
    assert.equal(h.win.document.getElementById("team-member-name").value, "Korunacak uzman adı", "Applied fields survive the deferred move to the desktop inspector");
    await h.resize(900);
    await h.ui.act(async () => { findButton("Close").click(); });
    assert.equal(h.win.document.getElementById("team-member-name"), null);
  } finally { await h.close(); }
});

test("desktop inspector remains mounted across a smaller breakpoint until its fields are applied", async () => {
  const h = harness(1200);
  let pending = false;
  let latest: any;
  try {
    await h.render(h.ui.Designer, { initialState: h.ui.workspaceFromTemplate(h.ui.template), onChange: (value: any) => { latest = value; }, onPendingChange: (value: boolean) => { pending = value; } });
    const field = h.win.document.getElementById("team-member-name");
    await h.ui.act(async () => {
      Object.getOwnPropertyDescriptor(h.win.HTMLInputElement.prototype, "value")!.set!.call(field, "Korunan yönetici taslağı");
      field.dispatchEvent(new h.win.Event("input", { bubbles: true }));
    });
    assert.equal(pending, true);
    await h.resize(700);
    assert.equal(h.win.document.getElementById("team-member-name"), field);
    assert.equal(field.value, "Korunan yönetici taslağı");
    await h.ui.act(async () => { field.closest("form").dispatchEvent(new h.win.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(pending, false);
    assert.equal(latest.document.members[0].name, "Korunan yönetici taslağı");
    await h.ui.act(async () => { h.win.document.querySelector('[data-testid="team-node-manager"]').click(); });
    assert.equal(h.win.document.getElementById("team-member-name").value, "Korunan yönetici taslağı");
  } finally { await h.close(); }
});

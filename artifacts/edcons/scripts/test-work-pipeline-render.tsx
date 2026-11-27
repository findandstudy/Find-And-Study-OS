import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { I18nContext } from "../src/lib/i18n/use-i18n-context";
import {
  SUPPORTED_LANGUAGES,
  RTL_LANGUAGES,
  loadLanguage,
  getTranslation,
} from "../src/lib/i18n/index";
import { WorkPipelineExcel } from "../src/pages/staff/WorkPipelineExcel";
import { WorkPipelineActivity } from "../src/pages/staff/WorkPipelineActivity";
import { WorkPipelinePicker } from "../src/pages/staff/WorkPipelinePicker";
import { WorkPipelineInboxSidebar } from "../src/components/inbox/WorkPipelineInboxSidebar";
import { AssignPopover } from "../src/components/AssignPopover";
import { PhoneInput } from "../src/components/ui/phone-input";
import type { Row, Card, Board } from "../src/pages/staff/useWorkPipelines";

const id = "00000000-0000-4000-8000-000000000001";
const card = {
  document: {
    id,
    title: "TEST custom name",
    stageId: id,
    assigneeId: null,
    notes: [],
    history: [],
    followUps: [],
  },
  revision: 1,
} as Row<Card>;
const board = {
  id,
  name: "TEST custom pipeline",
  stages: [{ id, name: "TEST custom stage", color: "#2563eb", result: "open" }],
  memberIds: [],
  sources: [],
  createdBy: 1,
  description: "",
  archived: false,
  history: [],
} as Board;
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
for (const lang of SUPPORTED_LANGUAGES) {
  await loadLanguage(lang);
  const t = (key: string) => getTranslation(lang, key);
  const isRTL = RTL_LANGUAGES.includes(lang),
    dir = isRTL ? ("rtl" as const) : ("ltr" as const);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nContext.Provider
        value={{
          lang,
          t,
          isRTL,
          dir,
          setLang: async () => true,
          localePath: (path) => path,
        }}
      >
        <Router ssrPath="/staff/pipelines">
          <WorkPipelinePicker
            lang={lang}
            selected={id}
            current={board}
            choose={() => {}}
            userId={undefined}
          />
          <WorkPipelineExcel
            id={id}
            name={board.name}
            lang={lang}
            archived={false}
            query=""
            stage="all"
            assignee="all"
            refresh={async () => {}}
          />
          <WorkPipelineActivity
            lang={lang}
            row={card}
            people={[]}
            person={() => "TEST person"}
            busy={false}
            disabled={false}
            save={async () => true}
          />
          <WorkPipelineInboxSidebar
            state={{
              linked: true,
              items: [
                {
                  boardId: id,
                  boardName: board.name,
                  revision: 1,
                  stages: board.stages,
                  people: [],
                  card: {
                    ...card.document,
                    contactName: "",
                    email: "",
                    phone: "",
                  },
                },
              ],
            }}
            onUpdated={() => {}}
          />
          <AssignPopover staffUsers={[]} onAssign={() => {}} />
          <PhoneInput value="" onChange={() => {}} />
        </Router>
      </I18nContext.Provider>
    </QueryClientProvider>,
  );
  for (const key of [
    "workPipelines.choosePipeline",
    "workPipelines.exportExcel",
    "workPipelines.importExcel",
    "workPipelines.followups",
    "workPipelines.pipelineStageText",
    "workPipelines.pipelineAssignee",
    "messagesPage.assignOwner",
    "phone.selectCountry",
  ])
    assert.ok(html.includes(escape(t(key))), `${lang}: ${key}`);
  assert.ok(html.includes(`dir="${dir}"`), `${lang}: direction`);
  assert.ok(html.includes("TEST custom pipeline"));
  assert.doesNotMatch(html, /workPipelines\.[a-zA-Z]/);
  client.clear();
}
console.log(
  "PASS: picker, Excel controls, activity, inbox, assignment and phone render in all 23 languages; custom names preserved; RTL included.",
);

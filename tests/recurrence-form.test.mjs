import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the actual form component without a browser or a database connection.
const source = await readFile(new URL("../app/components/EventRecurrenceFields.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replaceAll('"react"', JSON.stringify(import.meta.resolve("react")))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")))
  .replaceAll('"@/lib/calendar-recurrence"', JSON.stringify(new URL("../lib/calendar-recurrence.ts", import.meta.url).href));
const { EventRecurrenceFields } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const render = (props) => renderToStaticMarkup(createElement(EventRecurrenceFields, props));

test("new event offers three native radio choices and defaults to no repeat", () => {
  const html = render({ start: "2026-10-26" });
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  for (const label of ["매월", "매년"]) assert.ok(html.includes(label));
  assert.match(html, /반복 안 함/);
  assert.match(html, /name="recurrence_frequency"[^>]*checked=""[^>]*value=""/);
  assert.match(html, /name="recurrence_rule"[^>]*value=""/);
  assert.doesNotMatch(html, /반복 미리보기|반복 종료/);
});

test("editing a monthly series restores its end date, original day and date hint", () => {
  const html = render({ start: "2026-01-31", initialRule: "FREQ=MONTHLY;UNTIL=20260331" });
  assert.match(html, /name="recurrence_frequency"[^>]*checked=""[^>]*value="MONTHLY"/);
  assert.match(html, /min="2026-01-31"/);
  assert.match(html, /value="2026-03-31"/);
  assert.match(html, /그달의 마지막 날/);
  assert.match(html, /2026년 2월 28일/);
  assert.match(html, /2026년 3월 31일/);
  assert.match(html, /aria-describedby="recurrence-until-hint"/);
});

test("editing a yearly series previews actual years and has no forced end date", () => {
  const html = render({ start: "2024-02-29", initialRule: "FREQ=YEARLY" });
  assert.match(html, /name="recurrence_frequency"[^>]*checked=""[^>]*value="YEARLY"/);
  assert.match(html, /value="never" selected=""/);
  assert.match(html, /2025년 2월 28일/);
  assert.match(html, /2026년 2월 28일/);
  assert.doesNotMatch(html, /type="date"/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { isResourceName, pickAllowedFields, resourceConfigs } from "../lib/supabase-rest.ts";

const source = await readFile(new URL("../app/components/OipApp.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("OipApp.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functionCode(name, jsx = ts.JsxEmit.React) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found, `Expected production function ${name}`);
  return ts.transpileModule(found.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx, jsxFactory: "createElement" },
  }).outputText;
}

function callback(name, context) {
  return new Function(...Object.keys(context), `${functionCode(name)}; return ${name};`)(...Object.values(context));
}

function panel(items, overrides = {}, initialName = "") {
  const state = [initialName, false, []];
  let cursor = 0;
  const component = callback("TravelWishlistPanel", {
    createElement,
    useState(initial) {
      const index = cursor++;
      if (state[index] === undefined) state[index] = initial;
      return [state[index], value => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      }];
    },
  });
  return {
    state,
    render() {
      cursor = 0;
      return component({ items, onCreate: async () => true, onToggle: async () => true, onDelete: async () => true, ...overrides });
    },
  };
}

const fixture = { id: "wish-1", name: "아이슬란드 오로라", is_completed: false, author_id: "daeho" };

test("travel navigation places wishlist first and switches between all three existing views", () => {
  const state = [];
  let cursor = 0;
  const view = callback("TravelView", {
    createElement,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = value; }];
    },
    useMemo: calculate => calculate(), useEffect() {},
    toDateKey: () => "2026-11-08", initialMapTripSelection: () => null,
    tripChecklistFromMemo: () => [],
    TravelWishlistPanel: "wishlist-panel", EmptyState: "empty-state", TravelMap: "travel-map",
  });
  const onCreate = async () => true;
  function render() {
    cursor = 0;
    return view({
      trips: [], flights: [], accommodations: [], transportations: [], foods: [], places: [],
      travelLinkPlaces: [], travelLinkSources: [], wishlist: [fixture],
      googleMapsApiKey: "", isActive: true, theme: "light", onCreateWishlistItem: onCreate,
    });
  }
  let tree = render();
  let tabs = tree.props.children[0].props.children;
  assert.deepEqual(tabs.map(tab => tab.props.children), ["가고 싶은 곳", "여행목록", "지도"]);
  assert.equal(tabs[0].props["aria-selected"], true);
  assert.equal(tree.props.children[1].props.hidden, false);
  assert.equal(tree.props.children[1].props.children.props.items[0], fixture);
  assert.equal(tree.props.children[1].props.children.props.onCreate, onCreate);
  tabs[1].props.onClick();
  tree = render();
  assert.equal(tree.props.children[1].props.hidden, true);
  assert.equal(tree.props.children[2].props.hidden, false);
  tree.props.children[0].props.children[2].props.onClick();
  tree = render();
  assert.equal(tree.props.children[2].props.hidden, true);
  assert.equal(tree.props.children[3].props.hidden, false);
  assert.equal(tree.props.children[3].props.children[0].props.isVisible, true);
});

test("wishlist separates completed places and provides named completion, undo and remove actions", () => {
  const completed = { ...fixture, id: "wish-2", name: "교토", is_completed: true };
  const html = renderToStaticMarkup(panel([fixture, completed]).render());
  assert.match(html, /aria-label="가고 싶은 곳"/);
  assert.match(html, /maxlength="160"/i);
  assert.match(html, /aria-label="아이슬란드 오로라 완료" aria-pressed="false"/);
  assert.match(html, /<details[^>]*>[\s\S]*완료한 곳 1[\s\S]*aria-label="교토 완료 취소" aria-pressed="true"/);
  assert.match(html, /aria-label="교토 제거"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
});

test("wishlist form keeps the draft after failure, clears it only after success, and blocks repeat submits", async () => {
  for (const saved of [false, true]) {
    let finish;
    const calls = [];
    const view = panel([], { onCreate: name => {
      calls.push(name);
      return new Promise(resolve => { finish = resolve; });
    } }, "  아이슬란드  ");
    const submit = view.render().props.children[0].props.onSubmit({ preventDefault() {} });
    assert.equal(view.state[1], true);
    await view.render().props.children[0].props.onSubmit({ preventDefault() {} });
    assert.deepEqual(calls, ["아이슬란드"]);
    assert.match(renderToStaticMarkup(view.render()), /저장 중…/);
    finish(saved);
    await submit;
    assert.equal(view.state[0], saved ? "" : "  아이슬란드  ");
    assert.equal(view.state[1], false);
  }
});

test("wishlist create persists a trimmed place without requiring a trip or dates", async () => {
  for (const saved of [false, true]) {
    let items = [];
    const writes = [];
    const create = callback("createWishlistItem", {
      newId: () => "new-wish", currentUser: "sanghee",
      writeRecord: async (...args) => { writes.push(args); return saved; },
      setTravelWishlist: update => { items = update(items); },
    });
    assert.equal(await create("  스위스  "), saved);
    assert.deepEqual(writes[0].slice(0, 2), ["POST", "travel_wishlist"]);
    assert.equal(writes[0][2].name, "스위스");
    assert.equal(writes[0][2].author_id, "sanghee");
    assert.equal(writes[0][2].is_completed, false);
    assert.equal(items.length, saved ? 1 : 0);
    assert.equal(await create("   "), false);
    assert.equal(await create("가".repeat(161)), false);
    assert.equal(writes.length, 1);
  }
});

test("completion and undo change only the matching item after persistence succeeds", async () => {
  for (const saved of [false, true]) {
    let items = [fixture, { ...fixture, id: "other" }];
    const writes = [];
    const toggle = callback("toggleWishlistItem", {
      writeRecord: async (...args) => { writes.push(args); return saved; },
      setTravelWishlist: update => { items = update(items); },
    });
    assert.equal(await toggle(items[0]), saved);
    assert.deepEqual(writes[0], ["PATCH", "travel_wishlist", { is_completed: true }, fixture.id]);
    assert.equal(items[0].is_completed, saved);
    assert.equal(items[1].is_completed, false);
    if (saved) {
      assert.equal(await toggle(items[0]), true);
      assert.equal(items[0].is_completed, false);
    }
  }
});

test("removal requires confirmation and a successful database delete", async () => {
  for (const confirmed of [false, true]) {
    for (const saved of [false, true]) {
      let items = [fixture];
      const writes = [];
      const remove = callback("deleteWishlistItem", {
        window: { confirm: () => confirmed },
        writeRecord: async (...args) => { writes.push(args); return saved; },
        setTravelWishlist: update => { items = update(items); },
      });
      assert.equal(await remove(fixture), confirmed && saved);
      assert.equal(items.length, confirmed && saved ? 0 : 1);
      assert.equal(writes.length, confirmed ? 1 : 0);
      if (confirmed) assert.deepEqual(writes[0], ["DELETE", "travel_wishlist", undefined, fixture.id]);
    }
  }
});

test("records API permits only the wishlist storage fields", () => {
  assert.equal(isResourceName("travel_wishlist"), true);
  assert.equal(resourceConfigs.travel_wishlist.table, "travel_wishlist");
  assert.deepEqual(pickAllowedFields("travel_wishlist", {
    ...fixture, trip_id: "unrelated-trip", created_at: "client-value", visibility: "shared",
  }), fixture);
});

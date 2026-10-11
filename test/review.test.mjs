// Regression tests for bugs found in code review. SDK objects are unit fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SDKEngine } from "../config/www/ha-map-sdk.mjs";
import { makeEngine } from "./fixtures.mjs";

const bounds = (map) => map.fit[0].points.map((p) => [p.lat(), p.lng()]);

for (const provider of ["naver", "google"]) {
  test(`${provider}: fitBounds pads each side by HA's default ratio (0.5) like the native engines`, async () => {
    const { engine, map } = await makeEngine(SDKEngine, provider);
    engine.fitBounds([
      [37, 127],
      [38, 128],
    ]);
    assert.deepEqual(bounds(map), [
      [36.5, 126.5],
      [38.5, 128.5],
    ]);
    engine.fitBounds(
      [
        [37, 127],
        [38, 128],
      ],
      { pad: 0.25 },
    );
    assert.deepEqual(bounds(map), [
      [36.75, 126.75],
      [38.25, 128.25],
    ]);
    engine.destroy();
  });

  test(`${provider}: fitBounds on identical points centres without fitting a zero-area box`, async () => {
    const { engine, map } = await makeEngine(SDKEngine, provider);
    engine.fitBounds([
      [36, 128],
      [36, 128],
    ]);
    assert.equal(map.fit, undefined);
    assert.deepEqual(engine.getView(), { center: [36, 128], zoom: 12 });
    engine.destroy();
  });

  test(`${provider}: fitBounds maxZoom cap does not accumulate idle listeners`, async () => {
    const { engine, fake, map } = await makeEngine(SDKEngine, provider);
    const before = engine.listeners.length;
    for (let i = 0; i < 5; i++)
      engine.fitBounds(
        [
          [37, 127],
          [38, 128],
        ],
        { maxZoom: 10 },
      );
    map.zoom = 15;
    fake.Event.trigger(map, "idle");
    assert.equal(map.zoom, 10);
    assert.equal(engine.listeners.length, before);
    engine.destroy();
  });

  test(`${provider}: path point tooltip HTML is parsed inertly, never into a live element`, async () => {
    const { engine, doc, map } = await makeEngine(SDKEngine, provider);
    const path = engine.addPath({
      color: "red",
      segments: [],
      markers: [{ location: [37, 127], tooltipHtml: '<img src=x onerror="alert(1)">10:00' }],
    });
    assert.deepEqual(doc.innerHTMLWrites, ["template"]);
    const pane = provider === "naver" ? map.panes.overlayImage : map.panes.overlayMouseTarget;
    const dot = pane.children[0].children[0];
    assert.equal(dot.getAttribute("title"), "10:00");
    path.remove();
    engine.destroy();
  });
}

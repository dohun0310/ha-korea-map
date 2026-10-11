// Marker grouping for the provider (NAVER/Google) engines, following HA's MapLibre engine
// (frontend 20260930.3 src/common/map/engines/maplibre-map-engine.ts, _rebuildClusters):
// - only markers added with `cluster: true` take part; they appear on the next setClustering;
// - markers sharing a groupKey (their zone) form one group while they span at most
//   groupRadius screen pixels; the rest join any group with a member within `radius` pixels;
// - a group of two or more, or any keyed group, shows HA's icon from iconBuilder; a lone
//   unkeyed marker shows on its own;
// - overlapping icons merge; at the maximum zoom every icon opens (expanded);
// - activating an icon fits its members (pad 0.3, up to the maximum zoom) and opens it there
//   when zooming in further could not part it.
// HA owns the marker elements: they are only hidden while grouped, never destroyed.
// Not ported: MapLibre's "emerging" fade while a zoom parts a group, and regrouping ahead of
// an animated fit; here groups are rebuilt once the camera is idle at a new zoom.

export const CLUSTER_REBUILD_DELAY = 120;

const centerOf = (members) => [
  members.reduce((sum, m) => sum + m.location[0], 0) / members.length,
  members.reduce((sum, m) => sum + m.location[1], 0) / members.length,
];

const spread = (points) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

// Groups markers by screen distance. `project(location)` returns pixels at the zoom grouped for.
export function groupMarkers(markers, { radius, groupKey, groupRadius }, project) {
  const groups = [];
  const ungrouped = [];
  if (groupKey) {
    const byKey = new Map();
    for (const m of markers) {
      const key = groupKey(m.handle);
      if (key === undefined) ungrouped.push(m);
      else {
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(m);
      }
    }
    for (const [key, members] of byKey) {
      const points = members.map((m) => project(m.location));
      // A lone person in a zone still shows in a bubble pinned to that zone.
      if (members.length === 1 || spread(points) <= (groupRadius ?? radius)) {
        groups.push({ points, members, key });
      } else ungrouped.push(...members);
    }
  } else ungrouped.push(...markers);
  for (const m of ungrouped) {
    const point = project(m.location);
    const group = groups.find((g) =>
      g.points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius),
    );
    if (group) {
      group.members.push(m);
      group.points.push(point);
    } else groups.push({ points: [point], members: [m] });
  }
  return groups.map((g) => ({ members: g.members, key: g.key, center: centerOf(g.members) }));
}

// Whether the members would still share one group at `points` (pixels at the maximum zoom).
export function staysTogether(group, { radius, groupRadius }, points) {
  if (group.key !== undefined && spread(points) <= (groupRadius ?? radius)) return true;
  const linked = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const from = points[queue.pop()];
    points.forEach((p, i) => {
      if (!linked.has(i) && Math.hypot(p.x - from.x, p.y - from.y) <= radius) {
        linked.add(i);
        queue.push(i);
      }
    });
  }
  return linked.size === points.length;
}

const groupTitle = (group) =>
  group.members
    .map((m) => m.options.title)
    .filter(Boolean)
    .join(", ") || undefined;

// host: {
//   zoom(): number, maxZoom(): number,
//   project(location): {x, y} | undefined   pixels at the current zoom,
//   show(marker), hide(marker)              marker = {location, options, handle, element},
//   place(element, location, {size, anchor}): {remove()},
//   fit(points, options), activeElement(): Element | null,
//   setTimeout, clearTimeout
// }
export class ClusterLayer {
  constructor(host) {
    this.host = host;
    this.markers = [];
    this.options = null;
    this.groups = [];
    this.timer = null;
    this.dead = false;
  }
  add(marker) {
    this.markers.push(marker);
  }
  remove(marker) {
    marker.removed = true;
    const index = this.markers.indexOf(marker);
    if (index !== -1) this.markers.splice(index, 1);
  }
  setOptions(options) {
    this.options = options || null;
    this.rebuild(true);
  }
  refresh() {
    this.rebuild(false);
  }
  enabled() {
    return !!this.options;
  }
  // Camera settled (idle) or zoom changed: regroup once it rests at a new zoom.
  cameraChanged() {
    if (this.dead || !this.options) return;
    this.host.clearTimeout(this.timer);
    this.timer = this.host.setTimeout(() => {
      this.timer = null;
      if (this.dead || !this.options) return;
      if (this.force || this.host.zoom() !== this.groupedZoom) this.rebuild(true);
    }, CLUSTER_REBUILD_DELAY);
  }
  projectAt(location, zoom) {
    const p = this.host.project(location);
    if (!p) return { x: 0, y: 0 };
    const scale = 2 ** (zoom - this.host.zoom());
    return { x: p.x * scale, y: p.y * scale };
  }
  atMaxZoom() {
    return this.host.zoom() >= this.host.maxZoom() - 0.01;
  }
  clearIcons() {
    for (const group of this.groups) {
      group.placed?.remove();
      group.placed = undefined;
    }
  }
  rebuild(regroup = true) {
    if (this.dead) return;
    const clusterable = this.markers.filter((m) => m.options.cluster && !m.removed);
    // Focus on a member or icon passes to whatever replaces it.
    const active = this.host.activeElement?.();
    const focused = active
      ? (clusterable.find((m) => m.element?.contains?.(active)) ??
        this.groups.find((g) => g.icon?.element?.contains?.(active))?.members[0])
      : undefined;
    this.clearIcons();
    if (!this.options) {
      this.groups = [];
      clusterable.forEach((m) => this.host.show(m));
      return;
    }
    let groups;
    // OverlayView projections may not exist until the first SDK draw. Do not invent
    // origin pixels: keep individual markers visible and retry on the next idle.
    if (clusterable.some((m) => {
      const p = this.host.project(m.location);
      return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y);
    })) {
      this.groups = [];
      clusterable.forEach((m) => this.host.show(m));
      this.force = true;
      return;
    }
    if (!regroup && this.groups.length) {
      groups = this.groups
        .map((g) => ({ ...g, members: g.members.filter((m) => !m.removed) }))
        .filter((g) => g.members.length);
    } else {
      groups = groupMarkers(clusterable, this.options, (location) =>
        this.projectAt(location, this.host.zoom()),
      );
    }
    const pending = regroup ? this.openAfter : undefined;
    if (regroup) {
      this.openAfter = undefined;
      this.force = false;
      this.groupedZoom = this.host.zoom();
    }
    for (const g of groups) this.prepare(g, pending);
    this.groups = groups;
    if (regroup) this.mergeOverlapping(pending);
    for (const g of this.groups) {
      if (!g.icon) this.host.show(g.members[0]);
      else this.place(g);
    }
    if (focused) {
      const g = this.groups.find((x) => x.members.includes(focused));
      const target = g?.icon
        ? (g.open && g.icon.element.querySelector?.("[tabindex]")) || g.icon.element
        : focused.element;
      target?.focus?.();
    }
  }
  prepare(group, pending) {
    const bubbles = group.members.length > 1 || group.key !== undefined;
    if (
      bubbles &&
      !group.open &&
      (this.atMaxZoom() ||
        (pending?.some((m) => group.members.includes(m)) &&
          staysTogether(
            group,
            this.options,
            group.members.map((m) => this.projectAt(m.location, this.host.maxZoom())),
          )))
    ) {
      group.open = true;
    }
    group.icon = bubbles
      ? this.options.iconBuilder(
          group.members.map((m) => m.handle),
          group.center,
          group.key,
          !!group.open,
        )
      : undefined;
  }
  iconRect(group) {
    const { size, anchor, location } = group.icon;
    const p = this.projectAt(location ?? group.center, this.host.zoom());
    const [left, top] = anchor
      ? [p.x - anchor[0], p.y - anchor[1]]
      : [p.x - size[0] / 2, p.y - size[1] / 2];
    return { left, top, right: left + size[0], bottom: top + size[1] };
  }
  mergeOverlapping(pending) {
    for (;;) {
      const bubbles = this.groups.filter((g) => g.icon);
      const rects = bubbles.map((g) => this.iconRect(g));
      let pair;
      for (let i = 0; i < bubbles.length && !pair; i++) {
        for (let j = i + 1; j < bubbles.length && !pair; j++) {
          const a = rects[i];
          const b = rects[j];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
            pair = [bubbles[i], bubbles[j]];
        }
      }
      if (!pair) return;
      const members = [...pair[0].members, ...pair[1].members];
      // Two zones cannot share a pinned bubble.
      const keys = [pair[0].key, pair[1].key].filter((k) => k !== undefined);
      const merged = {
        members,
        key: keys.length === 1 ? keys[0] : undefined,
        center: centerOf(members),
      };
      this.prepare(merged, pending);
      this.groups = this.groups.filter((g) => !pair.includes(g)).concat(merged);
    }
  }
  place(group) {
    const { icon } = group;
    group.members.forEach((m) => this.host.hide(m));
    const element = icon.element;
    const title = groupTitle(group);
    const cleanups = [];
    if (group.open) {
      // The members inside are the buttons; the bubble only names the set.
      element.setAttribute?.("role", "group");
      if (title) element.setAttribute?.("aria-label", title);
    } else {
      element.setAttribute?.("role", "button");
      element.setAttribute?.("tabindex", "0");
      if (title) element.setAttribute?.("aria-label", title);
      const activate = () => this.zoomTo(group);
      const onClick = (ev) => {
        ev.stopPropagation?.();
        activate();
      };
      const onKey = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault?.();
          activate();
        }
      };
      element.addEventListener?.("click", onClick);
      element.addEventListener?.("keydown", onKey);
      cleanups.push(() => {
        element.removeEventListener?.("click", onClick);
        element.removeEventListener?.("keydown", onKey);
      });
    }
    const placed = this.host.place(element, icon.location ?? group.center, {
      size: icon.size,
      anchor: icon.anchor,
    });
    group.placed = {
      remove: () => {
        cleanups.forEach((fn) => fn());
        placed.remove();
      },
    };
  }
  zoomTo(group) {
    this.openAfter = group.members;
    this.force = true;
    this.host.fit(
      group.members.map((m) => m.location),
      { pad: 0.3, maxZoom: this.host.maxZoom() },
    );
    // A fit that leaves the zoom unchanged fires no zoom event; regroup on the next idle anyway.
    this.cameraChanged();
  }
  destroy() {
    this.dead = true;
    this.host.clearTimeout(this.timer);
    this.timer = null;
    this.clearIcons();
    this.groups = [];
    this.markers = [];
    this.options = null;
    this.openAfter = undefined;
  }
}

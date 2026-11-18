import * as THREE from 'three';
import { getSettings } from '../settings';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tileAt } from '../sim/state';
import type { GameState, Owner, Tile, Town } from '../sim/types';
import { hexCenterX, hexCenterZ, hexDist, neighbors } from '../sim/hex';

const TERRAIN_COLORS: Record<string, number> = {
  ocean: 0x255d7c,
  coast: 0xcdbb84,
  river: 0x3f87b0,
  grass: 0x79a84e,
  forest: 0x4a7a3d,
  hills: 0x8c8158,
  mountain: 0x90959f,
};
/** Unexplored ground: the uncharted dark. */
const FOG_COLOR = 0x0e1a24;

const OWNER_COLORS: Record<Owner, number> = {
  england: 0xb5432c,
  france: 0x3b5ba5,
  spain: 0xc9a227,
  netherlands: 0xc97b2c,
  sweden: 0x5a8f3c,
  portugal: 0x8a4fa3,
  denmark: 0xb83a3a,
  prussia: 0xcfc063,
  russia: 0x8a2a2a,
};

function hash2(q: number, r: number): number {
  let h = (q * 374761393 + r * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function tileHeight(t: Tile): number {
  const j = hash2(t.q, t.r) * 0.12;
  switch (t.terrain) {
    case 'ocean': return 0.05;
    case 'coast': return 0.11;
    case 'river': return 0.2 + j * 0.5;
    case 'grass': return 0.3 + j;
    case 'forest': return 0.33 + j;
    case 'hills': return 0.8 + j * 2;
    case 'mountain': return 1.4 + j * 3;
  }
}

interface ShipMesh {
  id: number;
  group: THREE.Group;
  pts: Array<{ x: number; z: number }>;
  acc: number[];
  total: number;
}

interface UnitRender {
  id: number;
  group: THREE.Group;
  x: number;
  z: number;
  tx: number;
  tz: number;
  q: number;
  r: number;
  born: number;
}

interface SceneInternal {
  renderer: THREE.WebGLRenderer;
  sceneRoot: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  terrain: THREE.InstancedMesh;
  townsGroup: THREE.Group;
  roadsGroup: THREE.Group;
  tribesGroup: THREE.Group;
  shipsGroup: THREE.Group;
  fleetGroup: THREE.Group;
  unitsGroup: THREE.Group;
  reachGroup: THREE.Group;
  labels: HTMLDivElement;
  ring: THREE.Line;
  marker: THREE.Mesh;
  shipMeshes: Map<number, ShipMesh>;
  unitRenders: Map<number, UnitRender>;
  treeTrunks: THREE.InstancedMesh | null;
  treeLeaves: THREE.InstancedMesh | null;
  /** Per tree instance: its matrices and the tile index it stands on (for fog hiding). */
  treeData: Array<{ trunk: THREE.Matrix4; leaves: THREE.Matrix4; tileIdx: number }> | null;
  state: GameState;
  tileCb: (q: number, r: number) => void;
  time: number;
  selectedUnit: number | null;
}

export interface SceneView {
  init(container: HTMLElement, s: GameState): void;
  refresh(s: GameState): void;
  update(dt: number, s: GameState): void;
  select(sel: { q: number; r: number; unitId?: number } | null): void;
  setReachable(tiles: Array<{ q: number; r: number }>): void;
  screenPos(q: number, r: number): { x: number; y: number } | null;
  shipRoute(q: number, r: number): Array<{ q: number; r: number; terrain: string }>;
  shipPos(id: number): { x: number; z: number } | null;
  pickAtScreen(x: number, y: number): { q: number; r: number } | null;
  onSelectTile(cb: (q: number, r: number) => void): void;
  dispose(): void;
  _s: SceneInternal | null;
}

let savedTileCb: ((q: number, r: number) => void) | null = null;

export const scene: SceneView = {
  init(container, s) {
    container.innerHTML = '';
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const sceneRoot = new THREE.Scene();
    sceneRoot.background = new THREE.Color(0x0b1420);
    sceneRoot.fog = new THREE.Fog(0x0b1420, 70, 190);

    const mapCX = hexCenterX((s.mapW - 1) / 2);
    const mapCZ = hexCenterZ((s.mapW - 1) / 2, (s.mapH - 1) / 2);

    const camera = new THREE.PerspectiveCamera(
      45, container.clientWidth / container.clientHeight, 0.1, 500,
    );
    camera.position.set(mapCX, 36, mapCZ + 34);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(mapCX, 0, mapCZ);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI / 2.25;
    controls.update();

    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3226, 0.95);
    sceneRoot.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe8c0, 1.5);
    sun.position.set(mapCX + 40, 55, mapCZ + 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 45;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0005;
    sceneRoot.add(sun);

    // terrain
    const hexGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
    hexGeo.rotateY(Math.PI / 6);
    const hexMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const terrain = new THREE.InstancedMesh(hexGeo, hexMat, s.mapW * s.mapH);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    s.tiles.forEach((t, i) => {
      const h = tileHeight(t);
      m.compose(
        new THREE.Vector3(hexCenterX(t.q), h / 2, hexCenterZ(t.q, t.r)),
        new THREE.Quaternion(),
        new THREE.Vector3(1, h, 1),
      );
      terrain.setMatrixAt(i, m);
      col.setHex(TERRAIN_COLORS[t.terrain]);
      const j = hash2(t.q + 7, t.r + 3) * 0.08;
      col.offsetHSL(0, 0, j - 0.04);
      terrain.setColorAt(i, col);
    });
    terrain.instanceMatrix.needsUpdate = true;
    if (terrain.instanceColor) terrain.instanceColor.needsUpdate = true;
    sceneRoot.add(terrain);

    // trees
    const treeTiles: Array<{ x: number; z: number; y: number; s: number; tileIdx: number }> = [];
    s.tiles.forEach((t, ti) => {
      if (t.terrain !== 'forest') return;
      const n = hash2(t.q * 3 + 1, t.r * 5 + 2) < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const a = hash2(t.q + i * 17, t.r + i * 29) * Math.PI * 2;
        const rr = 0.3 + hash2(t.q + i * 31, t.r + i * 41) * 0.45;
        treeTiles.push({
          x: hexCenterX(t.q) + Math.cos(a) * rr,
          z: hexCenterZ(t.q, t.r) + Math.sin(a) * rr,
          y: tileHeight(t),
          s: 0.7 + hash2(t.q + i * 11, t.r + i * 23) * 0.7,
          tileIdx: ti,
        });
      }
    });
    let treeTrunks: THREE.InstancedMesh | null = null;
    let treeLeaves: THREE.InstancedMesh | null = null;
    let treeData: SceneInternal['treeData'] = null;
    if (treeTiles.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.25, 5);
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5b4226 });
      const leafGeo = new THREE.ConeGeometry(0.22, 0.6, 6);
      const leafMat = new THREE.MeshLambertMaterial({ color: 0x3c6630 });
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeTiles.length);
      const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeTiles.length);
      trunks.castShadow = true;
      leaves.castShadow = true;
      treeData = [];
      treeTiles.forEach((tt, i) => {
        m.compose(new THREE.Vector3(tt.x, tt.y + 0.12 * tt.s, tt.z), new THREE.Quaternion(), new THREE.Vector3(tt.s, tt.s, tt.s));
        const trunk = m.clone();
        trunks.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(tt.x, tt.y + (0.25 + 0.3) * tt.s, tt.z), new THREE.Quaternion(), new THREE.Vector3(tt.s, tt.s, tt.s));
        const leaf = m.clone();
        leaves.setMatrixAt(i, m);
        treeData!.push({ trunk, leaves: leaf, tileIdx: tt.tileIdx });
      });
      trunks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      sceneRoot.add(trunks, leaves);
      treeTrunks = trunks;
      treeLeaves = leaves;
    }

    // selection ring
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([...ringPts, ringPts[0]]),
      new THREE.LineBasicMaterial({ color: 0xffd75e, linewidth: 2 }),
    );
    ring.visible = false;
    sceneRoot.add(ring);

    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.22, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd75e }),
    );
    marker.rotation.x = Math.PI;
    marker.visible = false;
    sceneRoot.add(marker);

    const townsGroup = new THREE.Group();
    const roadsGroup = new THREE.Group();
    const tribesGroup = new THREE.Group();
    const shipsGroup = new THREE.Group();
    const fleetGroup = new THREE.Group();
    const unitsGroup = new THREE.Group();
    const reachGroup = new THREE.Group();
    sceneRoot.add(townsGroup, roadsGroup, tribesGroup, shipsGroup, fleetGroup, unitsGroup, reachGroup);

    const labels = document.createElement('div');
    labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.appendChild(labels);

    const shipMeshes = new Map<number, ShipMesh>();
    const raycaster = new THREE.Raycaster();
    let downX = 0, downY = 0;

    renderer.domElement.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(terrain);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const id = hits[0].instanceId;
        this._s?.tileCb(id % s.mapW, Math.floor(id / s.mapW));
      }
    });

    window.addEventListener('resize', () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });

    this._s = {
      renderer, sceneRoot, camera, controls, terrain, townsGroup, roadsGroup, tribesGroup,
      shipsGroup, fleetGroup, unitsGroup, reachGroup, labels, ring, marker, shipMeshes,
      unitRenders: new Map(), treeTrunks, treeLeaves, treeData, state: s, tileCb: savedTileCb ?? (() => {}), time: 0,
      selectedUnit: null,
    };

    this.refresh(s);
  },

  _s: null,

  refresh(s: GameState) {
    const v = this._s;
    if (!v) return;
    v.state = s;
    // Fog of war: unexplored ground is dark; explored ground shows its terrain.
    const fogCol = new THREE.Color();
    const fogOn = getSettings().fog;
    s.tiles.forEach((t, i) => {
      const idx = t.r * s.mapW + t.q;
      if (fogOn && !s.explored[idx]) {
        fogCol.setHex(FOG_COLOR);
      } else {
        fogCol.setHex(TERRAIN_COLORS[t.terrain]);
        const j = hash2(t.q + 7, t.r + 3) * 0.08;
        fogCol.offsetHSL(0, 0, j - 0.04);
      }
      v.terrain.setColorAt(i, fogCol);
    });
    if (v.terrain.instanceColor) v.terrain.instanceColor.needsUpdate = true;
    // Your cleared lanes: brown ground and a laid plank, for those who can see them.
    v.roadsGroup.clear();
    // A unit box reused for every segment; each is scaled and yawed to link two tile
    // centres, so the lane reads as one connected track, not scattered planks.
    const segGeo = new THREE.BoxGeometry(1, 1, 1);
    const plankMat = new THREE.MeshLambertMaterial({ color: 0x7a5c3a });
    const seen = (ti: number) => !fogOn || s.explored[ti];
    for (const rd of s.roads) {
      for (const ti of rd.tiles) {
        if (!seen(ti)) continue;
        fogCol.setHex(0x6e5638).lerp(new THREE.Color(TERRAIN_COLORS[s.tiles[ti].terrain]), 0.25);
        v.terrain.setColorAt(ti, fogCol);
      }
      for (let i = 0; i + 1 < rd.tiles.length; i++) {
        const ta = rd.tiles[i];
        const tb = rd.tiles[i + 1];
        if (!seen(ta) || !seen(tb)) continue;
        const qa = ta % s.mapW, ra = Math.floor(ta / s.mapW);
        const qb = tb % s.mapW, rb = Math.floor(tb / s.mapW);
        const ax = hexCenterX(qa), az = hexCenterZ(qa, ra);
        const bx = hexCenterX(qb), bz = hexCenterZ(qb, rb);
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz) + 0.22; // overlap the joints so the track is unbroken
        const seg = new THREE.Mesh(segGeo, plankMat);
        seg.position.set((ax + bx) / 2, (tileHeight(s.tiles[ta]) + tileHeight(s.tiles[tb])) / 2 + 0.045, (az + bz) / 2);
        seg.rotation.y = Math.atan2(-dz, dx);
        seg.scale.set(len, 0.05, 0.32);
        v.roadsGroup.add(seg);
      }
    }
    if (v.terrain.instanceColor) v.terrain.instanceColor.needsUpdate = true;
    // Trees on unexplored ground must not betray the forests hiding in the fog.
    if (v.treeData && v.treeTrunks && v.treeLeaves) {
      const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < v.treeData.length; i++) {
        const td = v.treeData[i];
        const seen = !fogOn || s.explored[td.tileIdx];
        v.treeTrunks.setMatrixAt(i, seen ? td.trunk : hidden);
        v.treeLeaves.setMatrixAt(i, seen ? td.leaves : hidden);
      }
      v.treeTrunks.instanceMatrix.needsUpdate = true;
      v.treeLeaves.instanceMatrix.needsUpdate = true;
    }
    v.townsGroup.clear();
    v.tribesGroup.clear();
    v.labels.textContent = '';
    for (const t of s.towns) {
      const idx = t.r * s.mapW + t.q;
      if (fogOn && t.owner !== s.player && !s.visible[idx]) continue;
      const g = buildTown(t);
      g.position.set(hexCenterX(t.q), tileHeight(s.tiles[t.r * s.mapW + t.q]), hexCenterZ(t.q, t.r));
      v.townsGroup.add(g);
      addLabel(v, s, `${t.name} · ${t.pop}${t.owner === s.player ? ` · ♥${Math.round(t.loyalty)}` : ''}`, hexCenterX(t.q), tileHeight(s.tiles[t.r * s.mapW + t.q]) + 1.4, hexCenterZ(t.q, t.r), t.owner);
    }
    for (const tri of s.tribes) {
      const idx = tri.r * s.mapW + tri.q;
      if (fogOn && !s.visible[idx] && tri.alliance !== s.player && !tri.contact[s.player]) continue;
      const g = buildTribe(tri.id === 'powhatan' ? 0xc46a3a : 0x7a5c3e, tri);
      g.position.set(hexCenterX(tri.q), tileHeight(s.tiles[tri.r * s.mapW + tri.q]), hexCenterZ(tri.q, tri.r));
      v.tribesGroup.add(g);
      const allyTag = tri.alliance === s.player ? ' · ALLIED' : tri.alliance !== 'none' && s.rivals.includes(tri.alliance) ? ' · RIVAL ALLY' : '';
      addLabel(v, s, `${tri.name} · ${tri.pop}${allyTag}`, hexCenterX(tri.q), tileHeight(s.tiles[tri.r * s.mapW + tri.q]) + 1.2, hexCenterZ(tri.q, tri.r), null);
    }
    for (const [id, sm] of v.shipMeshes) {
      if (!s.ships.some((sh) => sh.id === id)) {
        v.shipsGroup.remove(sm.group);
        v.shipMeshes.delete(id);
      }
    }

    v.fleetGroup.clear();
    const start = s.playerStart;
    const near: Array<{ q: number; r: number; d: number; t: string }> = [];
    for (let r = 0; r < s.mapH; r++) {
      for (let q = 0; q < s.mapW; q++) {
        const d = hexDist(start.q, start.r, q, r);
        if (d < 1 || d > 3) continue;
        const tile = tileAt(s, q, r);
        if (tile && (tile.terrain === 'ocean' || tile.terrain === 'coast')) {
          near.push({ q, r, d, t: tile.terrain });
        }
      }
    }
    near.sort((a, b) => (a.t === 'ocean' ? -1 : 1) - (b.t === 'ocean' ? -1 : 1) || a.d - b.d);
    const water = near[0];
    if (water) {
      const wx = hexCenterX(water.q);
      const wz = hexCenterZ(water.q, water.r);
      for (let i = 0; i < 3; i++) {
        const ship = buildShip(s.player);
        ship.position.set(wx + (i - 1) * 0.95, 0.1, wz + (i % 2 === 0 ? 0.4 : -0.4));
        ship.rotation.y = Math.PI / 2;
        v.fleetGroup.add(ship);
      }
      addLabel(v, s, 'Ships from the mother country', wx, 1.2, wz, s.player);
    }

    for (const [id, ur] of v.unitRenders) {
      if (!s.units.some((u) => u.id === id)) {
        v.unitsGroup.remove(ur.group);
        v.unitRenders.delete(id);
      }
    }
    const byTile = new Map<string, number[]>();
    for (const u of s.units) {
      const k = `${u.q},${u.r}`;
      const list = byTile.get(k) ?? [];
      list.push(u.id);
      byTile.set(k, list);
    }
    for (const u of s.units) {
      let ur = v.unitRenders.get(u.id);
      const cx = hexCenterX(u.q);
      const cz = hexCenterZ(u.q, u.r);
      const ids = byTile.get(`${u.q},${u.r}`)!;
      const idx = ids.indexOf(u.id);
      const count = ids.length;
      const a = (Math.PI * 2 * idx) / Math.max(1, count) + 0.6;
      const rad = count > 1 ? 0.28 : 0;
      const tx = cx + Math.cos(a) * rad;
      const tz = cz + Math.sin(a) * rad;
      if (!ur) {
        ur = { id: u.id, group: buildSettler(u.owner, u.kind), x: tx, z: tz, tx, tz, q: u.q, r: u.r, born: v.time };
        v.unitsGroup.add(ur.group);
        v.unitRenders.set(u.id, ur);
      } else {
        ur.tx = tx;
        ur.tz = tz;
        ur.q = u.q;
        ur.r = u.r;
      }
      const uIdx = u.r * s.mapW + u.q;
      ur.group.visible = u.owner === s.player || !getSettings().fog || s.visible[uIdx];
    }
  },

  setReachable(tiles: Array<{ q: number; r: number }>) {
    const v = this._s;
    if (!v) return;
    v.reachGroup.clear();
    if (tiles.length === 0) return;
    const geo = new THREE.CylinderGeometry(0.86, 0.86, 0.04, 6);
    geo.rotateY(Math.PI / 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fd08a, transparent: true, opacity: 0.35 });
    for (const t of tiles) {
      const tile = tileAt(v.state, t.q, t.r);
      if (!tile) continue;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(hexCenterX(t.q), tileHeight(tile) + 0.03, hexCenterZ(t.q, t.r));
      v.reachGroup.add(m);
    }
  },

  update(dt: number, s: GameState) {
    const v = this._s;
    if (!v) return;
    v.controls.update();
    v.time += dt;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
    v.fleetGroup.children.forEach((ch, i) => {
      ch.position.y = 0.1 + Math.sin(v.time * 1.1 + i * 1.7) * 0.035 * calm;
      ch.rotation.z = Math.sin(v.time * 0.8 + i * 2.1) * 0.05 * calm;
    });
    for (const ur of v.unitRenders.values()) {
      const dx = ur.tx - ur.x;
      const dz = ur.tz - ur.z;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        const k = Math.min(1, dt * 7);
        ur.x += dx * k;
        ur.z += dz * k;
      }
      const age = v.time - ur.born;
      const pop = age < 0.25 ? age / 0.25 : 1;
      const tile = tileAt(v.state, ur.q, ur.r);
      const baseY = tile ? tileHeight(tile) : 0.3;
      ur.group.scale.setScalar(0.6 + 0.4 * pop);
      ur.group.position.set(ur.x, baseY + Math.sin(v.time * 2.2 + ur.id) * 0.012 * calm, ur.z);
    }
    if (v.selectedUnit != null) {
      const ur = v.unitRenders.get(v.selectedUnit);
      if (ur) {
        const tile = tileAt(v.state, ur.q, ur.r);
        const baseY = tile ? tileHeight(tile) : 0.3;
        v.ring.position.set(ur.x, baseY + 0.05, ur.z);
        v.marker.position.set(ur.x, baseY + 0.72 + Math.sin(v.time * 3) * 0.05 * calm, ur.z);
        v.ring.visible = true;
        v.marker.visible = true;
      } else {
        v.ring.visible = false;
        v.marker.visible = false;
        v.selectedUnit = null;
      }
    }
    const SPEED = 0.22;
    for (const sh of s.ships) {
      sh.t = Math.min(1, sh.t + dt * SPEED);
      let sm = v.shipMeshes.get(sh.id);
      if (!sm) {
        const pts = shipPath(v.state, sh.fromQ, sh.fromR);
        const acc: number[] = [0];
        for (let i = 1; i < pts.length; i++) {
          acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        }
        sm = { id: sh.id, group: buildShip(sh.owner), pts, acc, total: acc[acc.length - 1] };
        sm.group.position.set(pts[0].x, 0.12, pts[0].z);
        v.shipsGroup.add(sm.group);
        v.shipMeshes.set(sh.id, sm);
      }
      const e = easeOut(sh.t);
      const target = e * sm.total;
      let i = 1;
      while (i < sm.acc.length - 1 && sm.acc[i] < target) i++;
      const f = sm.acc[i] === sm.acc[i - 1] ? 0 : (target - sm.acc[i - 1]) / (sm.acc[i] - sm.acc[i - 1]);
      const p0 = sm.pts[i - 1];
      const p1 = sm.pts[i];
      sm.group.position.set(
        THREE.MathUtils.lerp(p0.x, p1.x, f),
        0.12 + Math.sin(sh.t * Math.PI) * 0.05,
        THREE.MathUtils.lerp(p0.z, p1.z, f),
      );
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      if (Math.hypot(dx, dz) > 0.001) sm.group.rotation.y = Math.atan2(-dz, dx);
    }
    for (const el of Array.from(v.labels.children)) {
      const d = el as HTMLDivElement;
      const p = new THREE.Vector3(
        Number(d.dataset.x ?? 0),
        Number(d.dataset.y ?? 0),
        Number(d.dataset.z ?? 0),
      );
      p.project(v.camera);
      const behind = p.z > 1;
      const x = (p.x * 0.5 + 0.5) * v.renderer.domElement.clientWidth;
      const y = (-p.y * 0.5 + 0.5) * v.renderer.domElement.clientHeight;
      d.style.display = behind ? 'none' : 'block';
      d.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    }
    v.renderer.render(v.sceneRoot, v.camera);
  },

  select(sel) {
    const v = this._s;
    if (!v) return;
    if (!sel) {
      v.ring.visible = false;
      v.marker.visible = false;
      v.selectedUnit = null;
      return;
    }
    if (sel.unitId != null) {
      v.selectedUnit = sel.unitId;
      v.ring.scale.setScalar(0.4);
      v.marker.visible = true;
      v.ring.visible = true;
      return;
    }
    v.selectedUnit = null;
    v.marker.visible = false;
    v.ring.scale.setScalar(1);
    const t = tileAt(v.state, sel.q, sel.r);
    if (!t) return;
    v.ring.position.set(hexCenterX(sel.q), tileHeight(t) + 0.06, hexCenterZ(sel.q, sel.r));
    v.ring.visible = true;
  },

  screenPos(q: number, r: number) {
    const v = this._s;
    if (!v) return null;
    const t = tileAt(v.state, q, r);
    if (!t) return null;
    const p = new THREE.Vector3(hexCenterX(q), tileHeight(t) + 0.3, hexCenterZ(q, r)).project(v.camera);
    return {
      x: (p.x * 0.5 + 0.5) * v.renderer.domElement.clientWidth,
      y: (-p.y * 0.5 + 0.5) * v.renderer.domElement.clientHeight,
    };
  },

  pickAtScreen(x: number, y: number) {
    const v = this._s;
    if (!v) return null;
    const rect = v.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, v.camera);
    const hits = ray.intersectObject(v.terrain);
    if (hits.length > 0 && hits[0].instanceId !== undefined) {
      const id = hits[0].instanceId;
      return { q: id % v.state.mapW, r: Math.floor(id / v.state.mapW) };
    }
    return null;
  },

  shipPos(id: number) {
    const v = this._s;
    if (!v) return null;
    const sm = v.shipMeshes.get(id);
    return sm ? { x: sm.group.position.x, z: sm.group.position.z } : null;
  },

  shipRoute(q: number, r: number) {
    const v = this._s;
    if (!v) return [];
    return shipCells(v.state, q, r).map((c) => ({
      q: c.q,
      r: c.r,
      terrain:
        c.q >= 0 && c.r >= 0 && c.q < v.state.mapW && c.r < v.state.mapH
          ? v.state.tiles[c.r * v.state.mapW + c.q].terrain
          : 'off',
    }));
  },

  onSelectTile(cb) {
    savedTileCb = cb;
    if (this._s) this._s.tileCb = cb;
  },

  dispose() {
    const v = this._s;
    if (!v) return;
    v.renderer.dispose();
    v.renderer.domElement.remove();
    v.labels.remove();
    this._s = null;
  },
};

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function addLabel(
  v: NonNullable<SceneView['_s']>,
  s: GameState,
  text: string,
  x: number, y: number, z: number,
  owner: Owner | null,
) {
  const d = document.createElement('div');
  d.className = 'map-label' + (owner ? ` owner-${owner}` : ' owner-tribe');
  d.textContent = text;
  d.dataset.x = String(x);
  d.dataset.y = String(y);
  d.dataset.z = String(z);
  v.labels.appendChild(d);
  void s;
}

function buildTown(t: Town): THREE.Group {
  const g = new THREE.Group();
  const baseGeo = new THREE.CylinderGeometry(0.55, 0.6, 0.08, 6);
  baseGeo.rotateY(Math.PI / 6);
  const base = new THREE.Mesh(
    baseGeo,
    new THREE.MeshLambertMaterial({ color: OWNER_COLORS[t.owner] }),
  );
  base.position.y = 0.04;
  base.receiveShadow = true;
  g.add(base);

  const houses = Math.min(6, 1 + Math.floor(t.pop / 10));
  const houseMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc0 });
  for (let i = 0; i < houses; i++) {
    const a = hash2(t.id * 13 + i, t.id * 7 + i * 3) * Math.PI * 2;
    const rr = houses > 1 ? 0.24 : 0;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.2), houseMat);
    h.position.set(Math.cos(a) * rr, 0.19, Math.sin(a) * rr);
    h.rotation.y = a;
    h.castShadow = true;
    g.add(h);
  }
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.7, 4),
    new THREE.MeshLambertMaterial({ color: 0x3a2e20 }),
  );
  pole.position.set(0.4, 0.4, 0);
  g.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.16),
    new THREE.MeshLambertMaterial({ color: OWNER_COLORS[t.owner], side: THREE.DoubleSide }),
  );
  flag.position.set(0.52, 0.62, 0);
  g.add(flag);

  if (t.improvements.includes('fort')) {
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8f });
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), wallMat);
      w.position.set(Math.cos(a) * 0.52, 0.22, Math.sin(a) * 0.52);
      w.castShadow = true;
      g.add(w);
    }
  }
  if (t.improvements.includes('dock')) {
    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.06, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    );
    pier.position.set(0.55, 0.03, 0);
    g.add(pier);
  }
  return g;
}

function buildTribe(color: number, tri: { pop: number }): THREE.Group {
  const g = new THREE.Group();
  const houses = Math.min(5, 1 + Math.floor(tri.pop / 200));
  const mat = new THREE.MeshLambertMaterial({ color });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a3826 });
  for (let i = 0; i < houses; i++) {
    const a = hash2(tri.pop + i * 17, i * 29) * Math.PI * 2;
    const rr = houses > 1 ? 0.26 : 0;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.18), mat);
    h.position.set(Math.cos(a) * rr, 0.1, Math.sin(a) * rr);
    h.rotation.y = a;
    h.castShadow = true;
    g.add(h);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.14, 4), roofMat);
    roof.position.set(Math.cos(a) * rr, 0.28, Math.sin(a) * rr);
    roof.rotation.y = a;
    g.add(roof);
  }
  return g;
}

function buildFrigate(owner: Owner): THREE.Group {
  const g = buildShip(owner);
  const hull = g.children[0] as THREE.Mesh;
  hull.scale.set(1.5, 1.1, 1.3);
  const secondMast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4),
    new THREE.MeshLambertMaterial({ color: 0x3a2e20 }),
  );
  secondMast.position.set(0.18, 0.35, 0);
  g.add(secondMast);
  const secondSail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshLambertMaterial({ color: 0xe6dcc4, side: THREE.DoubleSide }),
  );
  secondSail.position.set(0.18, 0.4, 0);
  secondSail.rotation.y = Math.PI / 2;
  g.add(secondSail);
  return g;
}

function buildSettler(owner: Owner, kind: 'settler' | 'militia' | 'soldier' | 'ranger' | 'frigate'): THREE.Group {
  if (kind === 'frigate') return buildFrigate(owner);
  const g = new THREE.Group();
  const arms = kind === 'militia' || kind === 'soldier' || kind === 'ranger';
  const bodyColor = kind === 'soldier' ? 0x8c2f2f : kind === 'ranger' ? 0x3f6b3f : kind === 'militia' ? 0x5c6470 : OWNER_COLORS[owner];
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, 0.2, 6),
    new THREE.MeshLambertMaterial({ color: bodyColor }),
  );
  body.position.y = 0.1;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 5),
    new THREE.MeshLambertMaterial({ color: 0xe8c39e }),
  );
  head.position.y = 0.26;
  g.add(head);
  const hat = new THREE.Mesh(
    arms
      ? new THREE.CylinderGeometry(0.085, 0.085, 0.05, 8)
      : new THREE.ConeGeometry(0.07, 0.07, 6),
    new THREE.MeshLambertMaterial({ color: arms ? 0x33383f : 0x4a3826 }),
  );
  hat.position.y = arms ? 0.32 : 0.33;
  g.add(hat);
  if (arms) {
    const staff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.42, 4),
      new THREE.MeshLambertMaterial({ color: 0x3a2e20 }),
    );
    staff.position.set(0.1, 0.21, 0);
    g.add(staff);
  }
  return g;
}

function shipCells(s: GameState, q0: number, r0: number): Array<{ q: number; r: number }> {
  const idx = (q: number, r: number) => r * s.mapW + q;
  const tile = (q: number, r: number): Tile | null =>
    q >= 0 && r >= 0 && q < s.mapW && r < s.mapH ? s.tiles[idx(q, r)] : null;

  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const startKey = idx(q0, r0);
  dist.set(startKey, 0);
  const open: number[] = [startKey];
  let exitKey: number | null = null;
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if ((dist.get(open[i]) ?? 0) < (dist.get(open[bi]) ?? 0)) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    if (cur === exitKey) break;
    const cq = cur % s.mapW;
    const cr = Math.floor(cur / s.mapW);
    if (tile(cq, cr)!.terrain === 'ocean' && exitKey === null) exitKey = cur;
    for (const n of neighbors(cq, cr)) {
      const nt = tile(n.q, n.r);
      if (!nt) continue;
      const step = nt.terrain === 'ocean' || nt.terrain === 'coast' || nt.terrain === 'river' ? 1 : 4;
      const key = idx(n.q, n.r);
      const nd = (dist.get(cur) ?? 0) + step;
      if (nd < (dist.get(key) ?? Infinity)) {
        dist.set(key, nd);
        prev.set(key, cur);
        open.push(key);
      }
    }
  }

  if (exitKey === null) return [{ q: q0, r: r0 }];

  const cells: Array<{ q: number; r: number }> = [];
  let cur: number | undefined = exitKey;
  while (cur !== undefined) {
    cells.push({ q: cur % s.mapW, r: Math.floor(cur / s.mapW) });
    cur = prev.get(cur);
  }
  cells.reverse();

  let guard = 0;
  while (guard++ < 40) {
    const last = cells[cells.length - 1];
    const before = cells[cells.length - 2] ?? last;
    const straight = { q: last.q + (last.q - before.q), r: last.r + (last.r - before.r) };
    let next: { q: number; r: number } | null = null;
    for (const c of [straight, ...neighbors(last.q, last.r)]) {
      const t = tile(c.q, c.r);
      if (t === null || t.terrain === 'ocean') {
        next = c;
        break;
      }
    }
    if (!next) break;
    cells.push(next);
    if (tile(next.q, next.r) === null) break;
  }

  return cells;
}

function shipPath(s: GameState, q0: number, r0: number): Array<{ x: number; z: number }> {
  const cells = shipCells(s, q0, r0);
  if (cells.length === 1) {
    const x0 = hexCenterX(q0);
    const z0 = hexCenterZ(q0, r0);
    return [{ x: x0, z: z0 }, { x: x0 + 16, z: z0 + 2 }];
  }
  const pts = cells.map((c) => ({ x: hexCenterX(c.q), z: hexCenterZ(c.q, c.r) }));
  const lastC = cells[cells.length - 1];
  const beforeC = cells[cells.length - 2] ?? lastC;
  const dx = hexCenterX(lastC.q) - hexCenterX(beforeC.q);
  const dz = hexCenterZ(lastC.q, lastC.r) - hexCenterZ(beforeC.q, beforeC.r);
  const len = Math.hypot(dx, dz) || 1;
  pts.push({
    x: pts[pts.length - 1].x + (dx / len) * 4,
    z: pts[pts.length - 1].z + (dz / len) * 4,
  });
  return pts;
}

function buildShip(owner: Owner): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.14, 0.2),
    new THREE.MeshLambertMaterial({ color: 0x5b4226 }),
  );
  hull.position.y = 0.07;
  hull.castShadow = true;
  g.add(hull);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4),
    new THREE.MeshLambertMaterial({ color: 0x3a2e20 }),
  );
  mast.position.y = 0.35;
  g.add(mast);
  const sail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xefe6d0, side: THREE.DoubleSide }),
  );
  sail.position.set(0, 0.42, 0);
  sail.rotation.y = Math.PI / 2;
  g.add(sail);
  const pennant = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.1),
    new THREE.MeshLambertMaterial({ color: OWNER_COLORS[owner], side: THREE.DoubleSide }),
  );
  pennant.position.set(0, 0.62, 0);
  g.add(pennant);
  return g;
}

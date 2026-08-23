import * as THREE from "three";

/* Chunky procedural canvas textures — nearest filtered for the PS2 wobble. */

function makeCanvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function finalize(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, n: number, colors: string[], alpha: number) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.random() * alpha;
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

export function floorTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = makeCanvas(s);
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a241e";
  g.fillRect(0, 0, s, s);
  // plate grid
  g.strokeStyle = "#171310";
  g.lineWidth = 3;
  for (let i = 0; i <= 2; i++) {
    g.beginPath();
    g.moveTo((i * s) / 2, 0);
    g.lineTo((i * s) / 2, s);
    g.stroke();
    g.beginPath();
    g.moveTo(0, (i * s) / 2);
    g.lineTo(s, (i * s) / 2);
    g.stroke();
  }
  // diamond tread
  g.fillStyle = "#3a322a";
  for (let y = 8; y < s; y += 16)
    for (let x = 8 + ((y / 16) % 2) * 8; x < s; x += 16) {
      g.save();
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      g.fillRect(-3, -3, 6, 6);
      g.restore();
    }
  // rust blotches
  for (let i = 0; i < 26; i++) {
    g.globalAlpha = 0.1 + Math.random() * 0.16;
    g.fillStyle = Math.random() < 0.5 ? "#5c3a1e" : "#4a2c14";
    g.beginPath();
    g.ellipse(Math.random() * s, Math.random() * s, 4 + Math.random() * 14, 3 + Math.random() * 9, Math.random() * 3, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
  // rivets
  g.fillStyle = "#4d4338";
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      for (let k = 0; k < 5; k++) {
        g.fillRect(6 + k * 12, 6 + i * 64 + j * 0, 3, 3);
      }
  speckle(g, s, 240, ["#000000", "#544838", "#6b5a44"], 0.25);
  return finalize(c, 10);
}

export function wallTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = makeCanvas(s);
  const g = c.getContext("2d")!;
  g.fillStyle = "#332b22";
  g.fillRect(0, 0, s, s);
  // corrugation
  for (let x = 0; x < s; x += 8) {
    g.fillStyle = x % 16 === 0 ? "#3e342a" : "#2a231b";
    g.fillRect(x, 0, 4, s);
  }
  // horizontal seams
  g.fillStyle = "#191410";
  g.fillRect(0, 30, s, 3);
  g.fillRect(0, 94, s, 3);
  // grime streaks
  for (let i = 0; i < 12; i++) {
    g.globalAlpha = 0.14;
    g.fillStyle = "#141009";
    const x = Math.random() * s;
    g.fillRect(x, 0, 2 + Math.random() * 4, 30 + Math.random() * 90);
  }
  g.globalAlpha = 1;
  // rust
  for (let i = 0; i < 14; i++) {
    g.globalAlpha = 0.2;
    g.fillStyle = "#6b3d1a";
    g.beginPath();
    g.ellipse(Math.random() * s, Math.random() * s, 3 + Math.random() * 8, 2 + Math.random() * 6, 0, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
  speckle(g, s, 200, ["#000", "#5a4c3a"], 0.2);
  return finalize(c, 6);
}

export function crateTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = makeCanvas(s);
  const g = c.getContext("2d")!;
  g.fillStyle = "#4c5340";
  g.fillRect(0, 0, s, s);
  g.strokeStyle = "#2c3126";
  g.lineWidth = 4;
  g.strokeRect(2, 2, s - 4, s - 4);
  g.beginPath();
  g.moveTo(2, 2);
  g.lineTo(s - 2, s - 2);
  g.moveTo(s - 2, 2);
  g.lineTo(2, s - 2);
  g.stroke();
  g.fillStyle = "#8b927a";
  g.fillRect(10, 26, 44, 12);
  g.fillStyle = "#22261c";
  g.font = "bold 11px monospace";
  g.fillText("AMMO-77", 12, 36);
  speckle(g, s, 90, ["#000", "#6e755c", "#3a4030"], 0.3);
  return finalize(c, 1);
}

export function barrelTexture(explosive: boolean): THREE.CanvasTexture {
  const s = 64;
  const c = makeCanvas(s);
  const g = c.getContext("2d")!;
  g.fillStyle = explosive ? "#8e2418" : "#4a4d52";
  g.fillRect(0, 0, s, s);
  g.fillStyle = explosive ? "#c43a22" : "#5d6167";
  g.fillRect(0, 0, s, 8);
  g.fillRect(0, s - 8, s, 8);
  g.fillStyle = "#1c120c";
  g.fillRect(0, 20, s, 3);
  g.fillRect(0, 42, s, 3);
  if (explosive) {
    g.fillStyle = "#ffb42e";
    g.fillRect(8, 26, 48, 13);
    g.fillStyle = "#171009";
    g.font = "bold 11px monospace";
    g.fillText("VOLATILE", 10, 36);
  } else {
    g.fillStyle = "#2c2f33";
    g.fillRect(12, 26, 40, 13);
    g.fillStyle = "#8a8f96";
    g.font = "bold 10px monospace";
    g.fillText("OIL", 24, 36);
  }
  speckle(g, s, 70, ["#000", "#00000088"], 0.3);
  return finalize(c, 1);
}

export function hazardTexture(): THREE.CanvasTexture {
  const s = 32;
  const c = makeCanvas(s);
  const g = c.getContext("2d")!;
  g.fillStyle = "#e6a51f";
  g.fillRect(0, 0, s, s);
  g.fillStyle = "#171009";
  g.save();
  g.translate(s / 2, s / 2);
  g.rotate(-Math.PI / 4);
  for (let i = -2; i <= 2; i++) g.fillRect(i * 18 - 4, -s, 9, s * 2);
  g.restore();
  return finalize(c, 4);
}

export function concreteTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = makeCanvas(s);
  const g = c.getContext("2d")!;
  g.fillStyle = "#3d3a34";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 20; i++) {
    g.globalAlpha = 0.15;
    g.fillStyle = Math.random() < 0.5 ? "#2a2723" : "#4c483f";
    g.beginPath();
    g.ellipse(Math.random() * s, Math.random() * s, 3 + Math.random() * 10, 2 + Math.random() * 7, 0, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
  g.strokeStyle = "#232019";
  g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
  speckle(g, s, 120, ["#000", "#57534a"], 0.3);
  return finalize(c, 3);
}

export function flashTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = makeCanvas(s);
  const g = c.getContext("2d")!;
  const cx = s / 2;
  const cy = s / 2;
  g.clearRect(0, 0, s, s);

  /* powder-burn crown — thin petal spikes of uneven length with dark gaps,
     the way an actual muzzle blast vents instead of a symmetric star */
  const petals = 6 + ((Math.random() * 3) | 0);
  let a = Math.random() * Math.PI * 2;
  for (let i = 0; i < petals; i++) {
    a += ((Math.PI * 2) / petals) * (0.65 + Math.random() * 0.7);
    const len = 30 + Math.random() * 27;
    const halfW = 3.2 + Math.random() * 4.2;
    const tipX = cx + Math.cos(a) * len;
    const tipY = cy + Math.sin(a) * len;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const grad = g.createLinearGradient(cx, cy, tipX, tipY);
    grad.addColorStop(0, "rgba(255,255,246,0.95)");
    grad.addColorStop(0.35, "rgba(255,198,110,0.65)");
    grad.addColorStop(1, "rgba(255,120,30,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx + nx * halfW, cy + ny * halfW);
    g.lineTo(tipX, tipY);
    g.lineTo(cx - nx * halfW, cy - ny * halfW);
    g.closePath();
    g.fill();
  }
  /* white-hot core */
  const core = g.createRadialGradient(cx, cy, 1, cx, cy, 30);
  core.addColorStop(0, "rgba(255,255,252,1)");
  core.addColorStop(0.25, "rgba(255,240,196,0.95)");
  core.addColorStop(0.55, "rgba(255,172,72,0.5)");
  core.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = core;
  g.beginPath();
  g.arc(cx, cy, 30, 0, Math.PI * 2);
  g.fill();
  /* stray incandescent specks */
  for (let i = 0; i < 8; i++) {
    const r = 13 + Math.random() * 24;
    const sa = Math.random() * Math.PI * 2;
    g.fillStyle = "rgba(255,242,205,0.75)";
    g.fillRect(cx + Math.cos(sa) * r - 1, cy + Math.sin(sa) * r - 1, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

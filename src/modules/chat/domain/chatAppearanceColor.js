function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue) {
  if (!Number.isFinite(hue)) {
    return 0;
  }
  const normalized = hue % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function toHexByte(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0').toUpperCase();
}

export function hsvToHex(color) {
  const h = normalizeHue(color.h);
  const s = clamp(color.s, 0, 1);
  const v = clamp(color.v, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  const r = (rPrime + m) * 255;
  const g = (gPrime + m) * 255;
  const b = (bPrime + m) * 255;
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

export function hexToHsv(hexColor) {
  const normalized = hexColor.trim();
  const match = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const hex = match[1].length === 3
    ? match[1].split('').map((char) => `${char}${char}`).join('')
    : match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  return {
    h: normalizeHue(h),
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

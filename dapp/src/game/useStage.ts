// Pan and zoom over a fixed-size stage inside a resizable viewport: drag to move, wheel to zoom
// around the pointer, Fit to frame the content box again. Pins scale up when zoomed far out so they
// stay readable (--ps).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";

export type Box = { x0: number; y0: number; x1: number; y1: number };

type Options = {
  /** Stage size in px. */
  W: number;
  H: number;
  /** The part Fit frames (and zoom centers on); defaults to the whole stage. */
  box?: Box;
  /** Room left around the box at Fit. */
  pad: number;
};

const MIN = 0.3;
const MAX = 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function useStage({ W, H, box, pad }: Options) {
  // A callback ref: the viewport mounts after the data loads, not with the hook.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [vp, setVp] = useState({ w: 900, h: 600 });
  const [cam, setCam] = useState<{ zoom: number | null; panX: number; panY: number }>({ zoom: null, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setVp((v) => (Math.abs(r.width - v.w) > 1 || Math.abs(r.height - v.h) > 1 ? { w: r.width, h: r.height } : v));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const b = box ?? { x0: 0, y0: 0, x1: W, y1: H };
  const view = useMemo(() => {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const fit = clamp(Math.min((vp.w - pad) / (b.x1 - b.x0), (vp.h - pad) / (b.y1 - b.y0)), MIN, MAX);
    const z = cam.zoom ?? fit;
    return { z, cx, cy, L: vp.w / 2 - cx * z + cam.panX, T: vp.h / 2 - cy * z + cam.panY };
  }, [b.x0, b.x1, b.y0, b.y1, vp.w, vp.h, pad, cam]);

  const clampPan = useCallback(
    (z: number, px: number, py: number) => {
      const mx = (W * z) / 2 + vp.w / 2 - 80;
      const my = (H * z) / 2 + vp.h / 2 - 80;
      return { panX: clamp(px, -mx, mx), panY: clamp(py, -my, my) };
    },
    [W, H, vp.w, vp.h],
  );

  const zoomTo = useCallback(
    (z2: number, mx: number, my: number) => {
      z2 = clamp(z2, MIN, MAX);
      const sx = (mx - view.L) / view.z;
      const sy = (my - view.T) / view.z;
      const pan = clampPan(z2, mx - sx * z2 - (vp.w / 2 - view.cx * z2), my - sy * z2 - (vp.h / 2 - view.cy * z2));
      setCam({ zoom: z2, ...pan });
    },
    [view, clampPan, vp.w, vp.h],
  );

  // A native, non-passive listener so the wheel zooms the map instead of scrolling the page.
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const zRef = useRef(view.z);
  zRef.current = view.z;
  useEffect(() => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(zRef.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [el]);

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, px: cam.panX, py: cam.panY, moved: false };
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      d.moved = true;
      setDragging(true);
      setCam((c) => ({ zoom: c.zoom, ...clampPan(view.z, d.px + dx, d.py + dy) }));
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (d?.moved) {
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 0);
        setDragging(false);
      }
    },
  };

  const ps = view.z < 0.85 ? Math.min(3, 0.85 / view.z) : 1;
  const stageStyle = {
    left: `${view.L.toFixed(1)}px`,
    top: `${view.T.toFixed(1)}px`,
    width: `${W}px`,
    height: `${H}px`,
    transform: `scale(${view.z.toFixed(3)})`,
    "--ps": ps.toFixed(3),
  } as CSSProperties;

  return {
    viewport: setEl,
    handlers: { ...handlers, onPointerLeave: handlers.onPointerUp },
    dragging,
    stageStyle,
    zoomLabel: `${Math.round(view.z * 100)}%`,
    zoomIn: () => zoomTo(view.z * 1.2, vp.w / 2, vp.h / 2),
    zoomOut: () => zoomTo(view.z / 1.2, vp.w / 2, vp.h / 2),
    fit: () => setCam({ zoom: null, panX: 0, panY: 0 }),
    /** True right after a drag ends, so the pointerup does not also pick what is under it. */
    wasDrag: () => justDragged.current,
  };
}

export type Stage = ReturnType<typeof useStage>;

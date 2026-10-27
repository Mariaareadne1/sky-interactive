import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SkyApp } from '../SkyApp';
import { useAppState } from '../../state/store';
import { surfaceWords, TOWN_SCALE } from '../../scene/town';
import { Icon } from './icons';

/**
 * A thin blue box around the selected plane with a readout — its size and
 * how high it is (or where it came down) — and a small bar of the four
 * things a plane can do. Positions are written straight to the DOM every
 * frame; no React renders.
 */

/** A folded sheet of paper: the plane's length in real metres. */
const PAPER_LENGTH_M = 0.3;
const BOX_RADIUS = 0.6;

export function SelectionOverlay({ app }: { app: SkyApp }) {
  const selection = useAppState(app.store, (s) => s.selection);
  const armed = useAppState(app.store, (s) => s.armed);
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selection) return;
    const corner = new THREE.Vector3();
    let lastText = '';
    const update = () => {
      const box = boxRef.current;
      const bar = barRef.current;
      const plane = app.planes.get(selection.id);
      if (!box || !bar || !plane) return;
      const cam = app.engine.camera;
      const rect = app.rect;
      const c = plane.position;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(c.x + (i & 1 ? 1 : -1) * BOX_RADIUS, c.y + (i & 2 ? 1 : -1) * BOX_RADIUS * 0.45, c.z + (i & 4 ? 1 : -1) * BOX_RADIUS).project(cam);
        const sx = ((corner.x + 1) / 2) * rect.width;
        const sy = ((1 - corner.y) / 2) * rect.height;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      box.style.transform = `translate(${minX.toFixed(1)}px, ${minY.toFixed(1)}px)`;
      box.style.width = `${(maxX - minX).toFixed(1)}px`;
      box.style.height = `${(maxY - minY).toFixed(1)}px`;
      if (labelRef.current) {
        const w = plane.whereabouts();
        const where = w.surface ? surfaceWords(w.surface as Parameters<typeof surfaceWords>[0]) : `${(w.altitude * TOWN_SCALE).toFixed(1)} m up`;
        const text = `${PAPER_LENGTH_M.toFixed(2)} m  ·  ${where}`;
        if (text !== lastText) labelRef.current.textContent = lastText = text;
      }
      // the bar sits under the box, or above it near the bottom edge
      const barW = bar.offsetWidth;
      const barH = bar.offsetHeight;
      const cx = Math.min(rect.width - barW / 2 - 12, Math.max(barW / 2 + 12, (minX + maxX) / 2));
      const below = maxY + 34 + barH < rect.height - 84;
      const y = below ? maxY + 30 : minY - barH - 12;
      bar.style.transform = `translate(${(cx - barW / 2).toFixed(1)}px, ${Math.max(8, y).toFixed(1)}px)`;
    };
    update();
    return app.engine.onBeforeRender(update);
  }, [app, selection]);

  if (!selection) return null;
  const id = selection.id;
  return (
    <>
      <div className="select-box" ref={boxRef} aria-hidden="true">
        <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
        <span className="select-label" ref={labelRef} />
      </div>
      <div className="action-bar" ref={barRef} role="toolbar" aria-label="Selected plane">
        <span className="bar-title">Paper plane</span>
        <Chip label="Fly again" icon="fly" title="Fly again (F)" onClick={() => app.flyAgain(id)} />
        <Chip label="Loop" icon="loop" title="Loop the loop (L)" onClick={() => app.loop(id)} />
        <Chip label="Draw its next flight" icon="draw" title="Draw its next flight (N)" on={armed === id} onClick={() => app.armNextFlight(id)} />
        <span className="sep" />
        <button className="icon-btn" title="Remove (Delete)" aria-label="Remove plane" onClick={() => app.remove(id)}><Icon name="trash" /></button>
      </div>
    </>
  );
}

function Chip({ label, title, on, onClick, icon }: { label: string; title?: string; on?: boolean; onClick: () => void; icon?: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <button className={on ? 'chip on' : 'chip'} title={title ?? label} aria-pressed={on} onClick={onClick}>
      {icon && <Icon name={icon} />}
      <span>{label}</span>
    </button>
  );
}

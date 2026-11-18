// Entry point: create the WebGL2 renderer and start the app (menus + networking). The match itself is in game.ts.
import { Renderer } from './gl';
import { App } from './ui';

function fail(msg: string) {
  const s = document.getElementById('screens');
  if (s) s.innerHTML = `<div class="screen on solid"><div class="in"><div class="big lose">NOT SUPPORTED</div><p class="small">${msg}</p></div></div>`;
}

function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
  if (!canvas) return;
  let r: Renderer;
  try { r = new Renderer(canvas); }
  catch (e) {
    console.error(e);
    return fail('お使いのブラウザ/端末では WebGL2 が使えないため、3D描画を開始できません。最新の Chrome / Edge / Firefox / Safari（iOS 15 以降）でお試しください。');
  }
  const app = new App(r);
  (window as any).__pn = { app };
}

window.addEventListener('error', (e) => console.error('[pn2]', e.message));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

// Screens and app flow: title -> menu -> lobby -> killer select -> loading/intro -> game -> results.
// All game rules live on the server; this file only presents state and sends the player's choices.
import { CHAT_PRESETS, LOBBY, MAP_IDS, MapId, PLAYERS_PER_MATCH, SURVIVOR_LOOKS, levelStartXp } from '../../shared/constants';
import { KILLER_IDS, KILLERS, KillerId } from '../../shared/killers';
import { PROPS } from '../../shared/props';
import type { InitMsg, ProfileInfo, RoomInfo, ServerMsg } from '../../shared/protocol';
import { Sfx } from './audio';
import { Game } from './game';
import { QUALITY, Renderer } from './gl';
import { Input, savePrefs } from './input';
import { MenuScene } from './menuscene';
import { Net, PROFILE_SUFFIX } from './net';

type EndMsg = Extract<ServerMsg, { t: 'end' }>;
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = (id: string) => document.getElementById(id)!;
const MAP_NAMES: Record<MapId | 'random', [string, string]> = {
  school: ['廃校', 'ABANDONED SCHOOL'], hotel: ['古いホテル', 'THE HOTEL'], factory: ['玩具工場', 'TOY FACTORY'], mall: ['閉店後のモール', 'DEAD MALL'], random: ['ランダム', 'RANDOM'],
};
const TIPS = [
  '小道具に変身して動かなければ、キラーの感知範囲に入るまで見つかりにくい。',
  '装置を修理すると音が出る。近くにキラーがいないか確認しよう。',
  '捕獲された仲間は封印装置の近くで救助できる。救助後は短時間だけ保護される。',
  '走るとスタミナを消費し、足音も大きくなる。曲がり角では歩こう。',
  'キラーの能力には必ず予兆（発動前の警告）がある。音と画面表示を見逃すな。',
  '残り2人が脱出すれば生存者の勝利。全員で無理に脱出しなくてもよい。',
  '心音が速くなったら、キラーはすぐ近くにいる。',
  'キラーは能力の再使用までに待ち時間がある。使い切った直後が逃げ時だ。',
];
const STATE_JP: Record<string, string> = { alive: '生存', sealed: '封印中', eliminated: '脱落', escaped: '脱出', killer: 'キラー' };
const ERR_TOAST_OK = new Set(['reported']);

export class App {
  net = new Net(); sfx = new Sfx(); input = new Input(); scene: MenuScene;
  host = $('screens');
  profile: ProfileInfo | null = null; room: RoomInfo | null = null; game: Game | null = null;
  cur = '';
  muted: Set<string>;
  pickLeft = 0; pickTimer = 0; pickSel = 0; pickSent = false;
  collTab: 'killers' | 'survivors' | 'props' = 'killers'; collSel = 0;
  settingsBack: 'menu' | 'game' = 'menu';
  last = performance.now();
  lastInit: InitMsg | null = null; lastEnd: EndMsg | null = null;
  quickRetries = 0; pendingJoin: string | null = null; wantQuick = false;
  introTimer = 0; lobbyKey = '';
  editRole: 'S' | 'K' = 'S';

  constructor(private r: Renderer) {
    this.scene = new MenuScene(r);
    this.muted = new Set(JSON.parse(this.safeGet('pn2_muted') ?? '[]'));
    this.input.attach($('gl'), $('touch'));
    if (new URLSearchParams(location.search).has('touch')) { this.input.touch = true; }
    const p = this.input.prefs;
    this.sfx.volume = p.volume;
    r.setQuality(QUALITY[p.quality === 'auto' ? (this.input.touch ? 'low' : 'medium') : p.quality]);
    this.pendingJoin = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase() || null;
    this.bindNet(); this.bindDom();
    this.showTitle();
    requestAnimationFrame(this.loop);
  }

  private safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
  private safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

  // ------------------------------------------------------------------ main loop (menus only; the game runs its own loop)
  loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.game) return;
    this.r.resize();
    this.scene.frame(dt);
  };

  // ------------------------------------------------------------------ misc UI helpers
  toast(msg: string, err = false) {
    const el = document.createElement('div'); el.className = 'toastm' + (err ? ' err' : ''); el.textContent = msg; $('toast').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
  show(name: string, html: string, cls: 'glass' | 'solid' = 'glass') {
    const still = name === this.cur;
    this.cur = name; if (!this.game) document.body.dataset.screen = name;
    this.host.innerHTML = `<div class="screen on ${cls}${still ? ' still' : ''}" data-scr="${name}"><div class="in">${html}</div></div>`;
  }
  hide() { this.cur = ''; this.host.innerHTML = ''; if (!this.game) document.body.dataset.screen = 'menu'; }
  legal() { return '<div class="legal"><a href="/legal/terms" target="_blank" rel="noopener">利用規約</a> ・ <a href="/legal/privacy" target="_blank" rel="noopener">プライバシーポリシー</a></div>'; }
  modal(html: string): HTMLElement {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="panel">${html}</div>`;
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    document.body.appendChild(m); return m;
  }
  swatch(ci: number) { return `style="background:${SURVIVOR_LOOKS[ci]?.shirt ?? '#555'}"`; }
  saveMuted() { this.safeSet('pn2_muted', JSON.stringify([...this.muted])); }

  // ------------------------------------------------------------------ DOM events (delegated)
  private bindDom() {
    this.host.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      this.sfx.play('ui');
      this.act(el.dataset.a!, el);
    });
    this.host.addEventListener('input', (e) => this.onSetting(e.target as HTMLInputElement));
    this.host.addEventListener('change', (e) => this.onSetting(e.target as HTMLInputElement));
    this.host.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { const el = (e.target as HTMLElement); if (el.id === 'name') this.act('enter', el); else if (el.id === 'code') this.act('join', el); } });
    const mq = matchMedia('(orientation: portrait)');
    const upd = () => { $('orient').classList.toggle('hidden', !(this.input.touch && mq.matches) || this.orientDismissed); };
    mq.addEventListener?.('change', upd); upd();
    $('orient-x').onclick = () => { this.orientDismissed = true; upd(); };
    addEventListener('resize', () => { this.r.resize(); upd(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.sfx.ctx?.state === 'suspended') this.sfx.ctx.resume().catch(() => {}); });
  }
  orientDismissed = false;

  private onSetting(el: HTMLInputElement) {
    const k = el.dataset.s; if (!k) return;
    const p = this.input.prefs;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'volume') { p.volume = Number(v) / 100; this.sfx.setVolume(p.volume); }
    else if (k === 'sens') p.sens = Number(v) / 100;
    else if (k === 'fov') p.fov = Number(v);
    else if (k === 'scale') { p.scale = Number(v) / 100; this.input.applyPrefs(); }
    else if (k === 'invertY') p.invertY = !!v;
    else if (k === 'quality') {
      p.quality = v as typeof p.quality;
      const q = p.quality === 'auto' ? (this.input.touch ? 'low' : 'medium') : p.quality;
      this.r.setQuality(QUALITY[q]);
      if (this.game) { this.game.userQual = p.quality; this.game.qName = q; }
    }
    savePrefs(p);
    const lab = el.parentElement?.querySelector('.val'); if (lab) lab.textContent = k === 'sens' || k === 'volume' || k === 'scale' ? `${Math.round(Number(v))}%` : String(v);
  }

  // ------------------------------------------------------------------ network
  private bindNet() {
    const n = this.net;
    n.onStatus = (s, info) => {
      const bar = $('netbar');
      if (s === 'reconnecting') { bar.textContent = '接続が切れました。再接続しています…（試合の席は60秒間保持されます）'; bar.classList.remove('hidden'); }
      else if (s === 'open') bar.classList.add('hidden');
      else if (s === 'closed') { bar.classList.add('hidden'); if (this.cur !== 'title' && this.cur !== 'lost') this.showLost(info ?? '接続が終了しました'); }
    };
    n.on('welcome', (m) => { this.profile = m.profile; });
    n.on('profile', (m) => { this.profile = m.profile; });
    n.on('room', (m) => this.onRoom(m.room));
    n.on('pickkiller', (m) => this.showPick(m.seconds));
    n.on('init', (m) => this.onInit(m));
    n.on('end', (m) => this.onEnd(m));
    n.on('err', (m) => { if (m.code === 'name_rejected' || ERR_TOAST_OK.has(m.code) || !['version', 'flood', 'rate', 'hello_timeout'].includes(m.code)) this.toast(m.msg, !ERR_TOAST_OK.has(m.code)); });
  }

  private onRoom(room: RoomInfo | null) {
    this.room = room;
    if (!room) {
      if (this.pendingJoin) { const c = this.pendingJoin; this.pendingJoin = null; this.net.send({ t: 'join', code: c }); return; }
      if (['lobby', 'waitkiller', 'pick', 'connecting', 'title'].includes(this.cur)) this.showMenu();
      return;
    }
    // block list: leave quick lobbies that contain someone we blocked (client-side preference; honest limit documented in README)
    if (room.kind === 'quick' && (room.phase === 'waiting' || room.phase === 'ready') && this.quickRetries < 3 && room.slots.some((s) => s && !s.isMe && this.muted.has(s.pub))) {
      this.quickRetries++; this.toast('ブロック中のプレイヤーがいたため、ルームを移動します');
      this.net.send({ t: 'leave' }); setTimeout(() => this.net.send({ t: 'quick' }), 600); return;
    }
    if (this.cur === 'results') return; // keep reading results; lobby updates are stored
    if (room.phase === 'waiting' || room.phase === 'ready') {
      const key = JSON.stringify([room.slots.map((s) => s && [s.pub, s.char, s.connected, s.host]), room.map, room.countdown, room.phase, Math.floor(room.waitedS / 5)]);
      if (this.cur !== 'lobby' || key !== this.lobbyKey) { this.lobbyKey = key; this.showLobby(); }
      else this.scene.lobby = room.slots.map((s) => (s ? s.char : -1));
    } else if (room.phase === 'roles') {
      if (room.youAreKiller) { if (this.cur !== 'pick') this.showPick(room.killerPickS ?? LOBBY.killerPickS); }
      else if (this.cur !== 'waitkiller') this.showWaitKiller();
    } else if ((room.phase === 'intro' || room.phase === 'playing') && !this.game && this.cur !== 'load') this.showLoad(null);
  }

  // ------------------------------------------------------------------ screens: title / connecting / menu
  showTitle() {
    this.scene.set('title');
    const nm = this.safeGet('pn2_name' + PROFILE_SUFFIX) ?? '';
    this.show('title', `
      <div class="logo">PROPNIGHT 2<small>THE NIGHTMARE RETURNS</small></div>
      <div class="menu">
        <input id="name" class="field" maxlength="12" placeholder="プレイヤー名（12文字まで）" value="${esc(nm)}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="btn-main" data-a="enter">夜に入る</button>
        <p class="small dim">ゲストとして遊べます。名前・進行状況は、このブラウザに保存される秘密トークンに紐づいてサーバーに保存されます。<br>本ゲームは5人の人間プレイヤーで遊ぶオンライン対戦です（AI・ボットは参加しません）。</p>
        <p class="small dim">「夜に入る」を押すと、利用規約とプライバシーポリシーに同意したものとみなします。</p>
      </div>${this.legal()}`);
  }

  async enter() {
    const el = $('name') as HTMLInputElement | null;
    const name = (el?.value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
    this.safeSet('pn2_name' + PROFILE_SUFFIX, name);
    await this.sfx.init(); this.sfx.setVolume(this.input.prefs.volume); this.sfx.startMusic();
    if (this.input.touch) {
      try { await document.documentElement.requestFullscreen?.(); } catch { /* iOS Safari has no fullscreen for pages */ }
      try { await (screen.orientation as any)?.lock?.('landscape'); } catch { /* not supported */ }
    }
    this.show('connecting', `<div class="eye"></div><div class="big">CONNECTING</div><div class="load"><i></i></div><p class="small dim">サーバーに接続しています…</p>`, 'glass');
    try { await this.net.connect(name); }
    catch { this.showLost('サーバーに接続できませんでした。ネットワークを確認して、もう一度お試しください。'); }
  }

  showLost(msg: string) {
    this.game?.stop(); this.game = null; this.input.enabled = false;
    this.scene.set('title');
    this.show('lost', `<div class="big lose">DISCONNECTED</div><p class="small">${esc(msg)}</p><div class="menu"><button class="btn-main" data-a="reload">再読み込み</button></div>${this.legal()}`, 'solid');
  }

  showMenu() {
    this.scene.set('title');
    this.sfx.startMusic();
    const p = this.profile;
    this.show('menu', `
      <div class="logo">PROPNIGHT 2<small>THE NIGHTMARE RETURNS</small></div>
      ${p ? `<p class="small">${esc(p.name)} ・ Lv.${p.level} ・ ${esc(p.title)}</p>` : ''}
      <div class="menu">
        <button class="btn-main" data-a="play">PLAY</button>
        <button class="btn-sub" data-a="collection">COLLECTION</button>
        <button class="btn-sub" data-a="profile">PROFILE</button>
        <button class="btn-sub" data-a="settings">SETTINGS</button>
        <button class="btn-sub" data-a="credits">CREDITS</button>
      </div>${this.legal()}`);
  }

  showPlay() {
    this.show('play', `
      <h2 class="title2">PLAY</h2>
      <div class="menu">
        <button class="btn-main" data-a="quick">QUICK MATCH</button>
        <button class="btn-sub" data-a="custom">CUSTOM MATCH</button>
        <button class="btn-sub" data-a="menu">戻る</button>
      </div>
      <p class="small dim" style="margin-top:14px">1試合 = 人間5人（キラー1 + 生存者4）。5人揃うまで試合は始まりません。AI・ボットが人数を埋めることはありません。</p>`);
  }
  showCustom() {
    this.show('custom', `
      <h2 class="title2">CUSTOM MATCH</h2>
      <div class="menu">
        <button class="btn-main" data-a="create">ルームを作る</button>
        <input id="code" class="field" maxlength="4" placeholder="ルームコード（4文字）" autocomplete="off" autocapitalize="characters" spellcheck="false" style="text-align:center;letter-spacing:.4em;text-transform:uppercase">
        <button class="btn-sub" data-a="join">コードで参加</button>
        <button class="btn-sub" data-a="play">戻る</button>
      </div>`);
  }

  // ------------------------------------------------------------------ lobby
  showLobby() {
    const room = this.room; if (!room) return;
    this.scene.set('lobby'); this.scene.lobby = room.slots.map((s) => (s ? s.char : -1));
    const me = room.slots.find((s) => s?.isMe) ?? null;
    const n = room.slots.filter(Boolean).length;
    const slots = room.slots.map((s, i) => s
      ? `<div class="slot ${s.isMe ? 'me' : ''}"><div class="sw" ${this.swatch(s.char)}></div><div class="nm">${esc(s.name)}</div><div class="lv">Lv.${s.level} ${SURVIVOR_LOOKS[s.char]?.name ?? ''}${s.connected ? '' : ' ・切断中'}</div>${s.host ? '<span class="host">HOST</span>' : ''}${s.isMe ? '' : `<span class="rp" data-a="player" data-pub="${s.pub}" data-name="${esc(s.name)}">通報/ミュート</span>`}</div>`
      : `<div class="slot empty">${i + 1}<br>待機中…</div>`).join('');
    const taken = new Set(room.slots.filter((s) => s && !s.isMe).map((s) => s!.char));
    const chars = SURVIVOR_LOOKS.map((L) => `<div class="chip ${me?.char === L.id ? 'sel' : ''} ${taken.has(L.id) ? 'taken' : ''}" data-a="char" data-c="${L.id}"><div class="sw" style="background:${L.shirt}"></div>${L.name}</div>`).join('');
    const isHost = !!me?.host;
    const maps = (['random', ...MAP_IDS] as (MapId | 'random')[]).map((m) => `<div class="chip ${room.map === m ? 'sel' : ''}" ${isHost && room.phase === 'waiting' ? `data-a="map" data-m="${m}"` : ''}>${MAP_NAMES[m][0]}</div>`).join('');
    let status: string;
    if (room.phase === 'ready' && room.countdown !== null) status = `<div class="big win">${room.countdown}</div><p class="small">まもなく開始 — キラーが決まります</p>`;
    else if (n < PLAYERS_PER_MATCH) status = `<div class="big">${n} / ${PLAYERS_PER_MATCH}</div><p class="small dim">人間のプレイヤーを待っています。5人揃うと${room.kind === 'quick' ? '自動で' : 'ホストが'}開始します。AI・ボットは参加しません。${room.waitedS > 60 ? '<br>なかなか集まりません。友達とカスタムマッチで遊ぶこともできます。' : ''}</p>`;
    else status = `<div class="big win">READY</div><p class="small dim">${isHost ? '「開始」を押してください' : 'ホストの開始を待っています'}</p>`;
    this.show('lobby', `
      <h2 class="title2">${room.kind === 'quick' ? 'QUICK MATCH' : 'CUSTOM MATCH'}</h2>
      ${room.kind === 'custom' ? `<div class="row"><span class="dim">ROOM CODE</span> <span class="code mono">${esc(room.code)}</span> <button class="btn-sub" style="width:auto;padding:8px 14px" data-a="copy">共有リンクをコピー</button></div>` : ''}
      <div class="slots">${slots}</div>
      ${status}
      <p class="small dim" style="margin:10px 0 4px">キャラクター</p><div class="chars">${chars}</div>
      <p class="small dim" style="margin:12px 0 4px">マップ${room.kind === 'custom' ? (isHost ? '（ホストが選択）' : '（ホストが選択中）') : '（クイックはランダム）'}</p>
      ${room.kind === 'custom' ? `<div class="chars">${maps}</div>` : ''}
      <div class="menu" style="margin-top:16px">
        ${room.kind === 'custom' && isHost ? `<button class="btn-main" data-a="start" ${n === PLAYERS_PER_MATCH && room.phase === 'waiting' ? '' : 'disabled'}>開始</button>` : ''}
        <button class="btn-sub danger" data-a="leave">ルームを出る</button>
      </div>`);
  }

  showWaitKiller() {
    this.scene.set('lobby');
    this.show('waitkiller', `<div class="eye"></div><div class="big">KILLER IS CHOOSING</div><p class="small dim">キラー役のプレイヤーが能力タイプを選んでいます…<br>あなたは生存者です。装置を修理して脱出しよう。</p>${this.legal()}`);
  }

  // ------------------------------------------------------------------ killer select (3D showroom)
  showPick(seconds: number) {
    this.pickLeft = seconds; this.pickSent = false;
    this.scene.set('killers', this.pickSel);
    clearInterval(this.pickTimer);
    this.pickTimer = window.setInterval(() => { this.pickLeft = Math.max(0, this.pickLeft - 1); const e = document.getElementById('pk-t'); if (e) e.textContent = String(this.pickLeft); if (this.pickLeft <= 0 || this.cur !== 'pick') clearInterval(this.pickTimer); }, 1000);
    this.renderPick();
  }
  killerInfo(id: KillerId): string {
    const k = KILLERS[id];
    const st = (l: string, v: number) => `<div class="stat"><label>${l}</label><i><b style="width:${v * 20}%"></b></i></div>`;
    return `<h2 style="color:${k.color}">${k.name}</h2><div class="jp">${k.jp}</div><p>${esc(k.blurb)}</p>
      ${st('難易度', k.stats.difficulty)}${st('機動力', k.stats.mobility)}${st('索敵', k.stats.detection)}${st('妨害', k.stats.disruption)}
      ${k.abilities.map((a, i) => `<div class="ab"><b>${['Q', 'E', 'R'][i]} ${esc(a.name)}</b><span>CD ${a.cooldown}s${a.duration ? ` / 効果 ${a.duration}s` : ''}${a.windup ? ` / 予兆 ${a.windup}s` : ''}</span><br>${esc(a.desc)}</div>`).join('')}
      <div class="tags">${k.strengths.map((s) => `<span>${esc(s)}</span>`).join('')}</div><div class="tags weak">${k.weaknesses.map((s) => `<span>${esc(s)}</span>`).join('')}</div>
      <p class="small dim" style="text-align:left">生存者の対策: ${k.counters.map(esc).join(' ／ ')}</p>`;
  }
  renderPick() {
    const id = KILLER_IDS[this.pickSel];
    this.show('pick', `
      <div style="position:absolute;left:calc(var(--sal) + 6px);top:6px"><div class="big" style="text-align:left;font-size:clamp(18px,3vw,28px)">キラーを選べ</div><p class="small dim" style="text-align:left">あなたが今回のキラーです — 残り <b id="pk-t" class="mono">${this.pickLeft}</b> 秒（未選択ならランダム）</p></div>
      <div class="kinfo"><div class="kbody">${this.killerInfo(id)}</div><button class="btn-main" style="margin-top:10px" data-a="kpick" ${this.pickSent ? 'disabled' : ''}>${this.pickSent ? '準備中…' : 'このキラーで開始'}</button></div>
      <div class="kpick">${KILLER_IDS.map((k, i) => `<div class="chip ${i === this.pickSel ? 'sel' : ''}" data-a="ksel" data-i="${i}" style="border-color:${i === this.pickSel ? KILLERS[k].color : ''}">${KILLERS[k].name.replace('THE ', '')}</div>`).join('')}</div>`, 'glass');
    this.host.firstElementChild!.classList.add('still');
  }

  // ------------------------------------------------------------------ collection / profile / settings / credits
  showCollection() {
    const tab = this.collTab;
    const n = tab === 'killers' ? KILLER_IDS.length : tab === 'survivors' ? SURVIVOR_LOOKS.length : PROPS.length;
    this.collSel = (this.collSel + n) % n;
    this.scene.set(tab, this.collSel);
    let info = '';
    if (tab === 'killers') info = this.killerInfo(KILLER_IDS[this.collSel]);
    else if (tab === 'survivors') {
      const L = SURVIVOR_LOOKS[this.collSel];
      const acc: Record<string, string> = { none: 'なし', glasses: 'メガネ', backpack: 'リュック', scarf: 'マフラー', headband: 'ヘアバンド' };
      info = `<h2>${L.name}</h2><div class="jp">生存者 ${L.id + 1} / ${SURVIVOR_LOOKS.length}</div><div class="kv"><span>髪型</span><span>${L.hairStyle}</span><span>アクセサリ</span><span>${acc[L.accessory]}</span><span>体格</span><span>身長 ${L.height.toFixed(2)} / 幅 ${L.width.toFixed(2)}</span></div><p class="small dim" style="text-align:left">外見はすべて同じ性能です（見た目による有利・不利はありません）。ロビーで好きなキャラクターを選べます。</p>`;
    } else {
      const P = PROPS[this.collSel];
      info = `<h2>${esc(P.name)}</h2><div class="jp">${esc(P.jp)} ・ 変身オブジェクト ${this.collSel + 1} / ${PROPS.length}</div><div class="kv"><span>大きさ</span><span>半径 ${P.r.toFixed(2)}m / 高さ ${P.h.toFixed(2)}m</span><span>動作</span><span>${P.mob ? '動いていても自然' : '静止物（動くと不自然）'}</span></div><p class="small dim" style="text-align:left">マップ内に実際に置かれている物にだけ変身できます。キラーに近づかれると見破られることがあります。</p>`;
    }
    const chips = tab === 'killers' ? KILLER_IDS.map((k, i) => `<div class="chip ${i === this.collSel ? 'sel' : ''}" data-a="csel" data-i="${i}">${KILLERS[k].name.replace('THE ', '')}</div>`).join('')
      : tab === 'survivors' ? SURVIVOR_LOOKS.map((L, i) => `<div class="chip ${i === this.collSel ? 'sel' : ''}" data-a="csel" data-i="${i}"><div class="sw" style="background:${L.shirt}"></div>${L.name}</div>`).join('') : '';
    this.show('collection', `
      <div class="tabs" style="position:absolute;top:6px;left:0;right:0"><button class="${tab === 'killers' ? 'on' : ''}" data-a="ctab" data-t="killers">キラー</button><button class="${tab === 'survivors' ? 'on' : ''}" data-a="ctab" data-t="survivors">生存者</button><button class="${tab === 'props' ? 'on' : ''}" data-a="ctab" data-t="props">変身オブジェクト</button></div>
      <div class="kinfo"><div class="kbody">${info}</div></div>
      <div class="navrow"><button class="btn-sub" data-a="cprev">◀</button>${chips ? `<div class="chars" style="max-width:60vw">${chips}</div>` : `<span class="mono">${this.collSel + 1} / ${n}</span>`}<button class="btn-sub" data-a="cnext">▶</button><button class="btn-sub" data-a="menu">戻る</button></div>`, 'glass');
    this.host.firstElementChild!.classList.add('still');
  }

  showProfile() {
    const p = this.profile!; const a = levelStartXp(p.level), b = levelStartXp(p.level + 1);
    const pct = Math.max(0, Math.min(100, ((p.xp - a) / Math.max(1, b - a)) * 100));
    const use = Object.entries(p.killerUse ?? {}).map(([k, v]) => `${KILLERS[k as KillerId]?.name ?? k} ×${v}`).join(' / ') || '—';
    this.show('profile', `
      <h2 class="title2">PROFILE</h2>
      <div class="panel wide">
        <div style="font-size:22px;font-weight:800">${esc(p.name)}</div><div class="dim">${esc(p.title)} ・ ID ${esc(p.pub)}</div>
        <div style="margin-top:10px">Lv.${p.level} <span class="dim mono">(${p.xp - a} / ${b - a} XP)</span></div><div class="xpbar"><i style="width:${pct}%"></i></div>
        <div class="kv"><span>試合数</span><span>${p.matches}</span><span>勝利 / 敗北</span><span>${p.wins} / ${p.losses}</span><span>キラー回数</span><span>${p.killerPlays}</span><span>脱出回数</span><span>${p.survivorEscapes}</span><span>使用キラー</span><span>${esc(use)}</span></div>
        <div style="margin:8px 0 4px" class="dim">実績</div><div class="tags">${p.achievements.length ? p.achievements.map((x) => `<span>${esc(x)}</span>`).join('') : '<span class="dim" style="background:none">まだありません</span>'}</div>
        <div style="margin:14px 0 4px" class="dim">名前の変更</div>
        <div class="row"><input id="newname" class="field" maxlength="12" value="${esc(p.name)}" style="width:200px"><button class="btn-sub" style="width:auto" data-a="rename">変更</button></div>
        <p class="small dim" style="text-align:left">スキンはキャラクター8種を無料で全て使えます。課金要素・勝敗に影響する要素はありません。</p>
      </div>
      <div class="menu"><button class="btn-sub" data-a="wipe">このブラウザのデータを削除</button><button class="btn-main" data-a="menu">戻る</button></div>`, 'solid');
  }

  showSettings() {
    const p = this.input.prefs;
    const sl = (label: string, k: string, min: number, max: number, val: number, unit = '%') => `<label class="sl">${label}<span class="val">${val}${unit}</span><input type="range" data-s="${k}" min="${min}" max="${max}" value="${val}"></label>`;
    this.show('settings', `
      <h2 class="title2">SETTINGS</h2>
      <div class="panel wide">
        ${sl('音量', 'volume', 0, 100, Math.round(p.volume * 100))}
        ${sl('視点感度', 'sens', 30, 250, Math.round(p.sens * 100))}
        ${sl('視野角 (FOV)', 'fov', 60, 100, p.fov, '°')}
        <label class="sl">視点の上下反転<input type="checkbox" data-s="invertY" ${p.invertY ? 'checked' : ''}></label>
        <label class="sl">画質<select class="field" data-s="quality">${(['auto', 'low', 'medium', 'high'] as const).map((q) => `<option value="${q}" ${p.quality === q ? 'selected' : ''}>${({ auto: '自動（推奨）', low: '低（軽量）', medium: '中', high: '高' })[q]}</option>`).join('')}</select></label>
        ${this.input.touch ? `${sl('ボタンの大きさ', 'scale', 70, 160, Math.round(p.scale * 100))}${this.settingsBack === 'menu' ? '<div class="row"><button class="btn-sub" style="width:auto" data-a="layout">ボタン配置を編集</button><button class="btn-sub" style="width:auto" data-a="layoutreset">配置リセット</button></div>' : '<p class="small dim">ボタン配置の編集はメインメニューの設定から行えます。</p>'}` : ''}
        <div class="row" style="margin-top:10px"><button class="btn-sub" style="width:auto" data-a="unmute" ${this.muted.size ? '' : 'disabled'}>ミュート/ブロック解除 (${this.muted.size})</button></div>
        <div style="margin-top:12px" class="dim small" style="text-align:left"><b>操作方法 (PC)</b>: WASD 移動 / マウス 視点 / Shift 走る / Ctrl・C しゃがむ / F 変身・解除 / E 長押し 修理・救助・ゲート / G チャット / Esc ポーズ<br>キラー: 左クリック 攻撃 / Q E R 能力<br><b>(スマホ)</b>: 左で移動スティック・右ドラッグで視点・右下ボタンで操作。横画面推奨。</div>
      </div>
      <div class="menu"><button class="btn-main" data-a="${this.settingsBack === 'game' ? 'backgame' : 'menu'}">戻る</button></div>`, this.settingsBack === 'game' ? 'glass' : 'solid');
  }

  showCredits() {
    this.show('credits', `
      <h2 class="title2">CREDITS</h2>
      <div class="panel wide"><p class="small" style="max-width:none;text-align:left">
        <b>PROPNIGHT 2 — THE NIGHTMARE RETURNS</b><br>5人の人間プレイヤーによる非対称型オンライン・ホラー（小道具に変身するかくれんぼ）。<br><br>
        ・3Dグラフィックス: 本作専用の独自WebGL2レンダラー。モデル・マップ・テクスチャはすべてコードで生成したオリジナルです。<br>
        ・サウンド: WebAudioによる完全合成音（外部音源ファイルは使用していません）。<br>
        ・サーバー: Node.js + ws。ゲーム進行はすべてサーバーが判定します（サーバー権威）。<br>
        ・キャラクター・キラー・マップ・名称はすべて本作オリジナルです。既存作品の素材は使用していません。<br><br>
        <a href="/legal/terms" target="_blank" rel="noopener" style="color:var(--acc)">利用規約</a> ・ <a href="/legal/privacy" target="_blank" rel="noopener" style="color:var(--acc)">プライバシーポリシー</a>
      </p></div>
      <div class="menu"><button class="btn-main" data-a="menu">戻る</button></div>`, 'solid');
  }

  // ------------------------------------------------------------------ loading / intro / game
  showLoad(map: MapId | null) {
    this.scene.set('title'); this.sfx.stopMusic();
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.show('load', `<div class="eye"></div><div class="big">${map ? MAP_NAMES[map][1] : 'LOADING'}</div><div class="load"><i></i></div><p class="small dim" style="margin-top:18px">TIP: ${esc(tip)}</p>`, 'solid');
  }

  private onInit(init: InitMsg) {
    this.game?.stop(); this.game = null; clearInterval(this.introTimer);
    this.lastInit = init; this.lastEnd = null; this.quickRetries = 0;
    this.showLoad(init.map);
    const t0 = performance.now();
    setTimeout(() => {
      try {
        this.game = new Game(this.r, this.net, this.sfx, this.input, init, {
          onLeave: () => this.leaveMatch(),
          blocked: (pub) => this.muted.has(pub),
          openSettings: () => { this.settingsBack = 'game'; this.showSettings(); },
        });
        this.sfx.stopMusic(); this.game.start();
      } catch (e) {
        console.error(e); this.showLost('3D描画を初期化できませんでした（WebGL2非対応の可能性があります）');
        return;
      }
      const g = this.game;
      // role reveal while the server's intro timer runs (the server does not accept movement during the intro)
      const reveal = () => {
        const wait = Math.max(0, 1300 - (performance.now() - t0));
        setTimeout(() => {
          if (this.game !== g) return;
          this.showIntro(init);
          clearInterval(this.introTimer);
          this.introTimer = window.setInterval(() => { if (this.game !== g) { clearInterval(this.introTimer); return; } if (g.playing || (init.resume && g.snap)) { clearInterval(this.introTimer); if (this.cur === 'intro' || this.cur === 'load') this.hide(); } }, 120);
        }, wait);
      };
      reveal();
    }, 60);
  }

  showIntro(init: InitMsg) {
    const k = KILLERS[init.killer];
    const t = this.input.touch;
    const body = init.role === 'K'
      ? `<div class="big lose">あなたは KILLER</div><div class="big" style="color:${k.color}">${k.name}</div><p class="small">${k.jp}<br>生存者を探し、攻撃して封印装置へ。${t ? '右下のボタンで攻撃・能力。' : '左クリックで攻撃、Q/E/R で能力。'}</p>`
      : `<div class="big win">あなたは SURVIVOR</div><p class="small">装置を${4}つ修理 → ゲートから脱出。${t ? '「変身」で近くの物に変身できます。' : 'Fで近くの物に変身。Eを長押しで修理。'}<br>2人以上が脱出すれば勝利。キラー: <b>${k.name}</b></p>`;
    this.show('intro', `${body}${init.resume ? '<p class="small dim">試合に復帰しました</p>' : ''}`, 'glass');
  }

  leaveMatch() {
    const m = this.modal(`<h2>試合を退出しますか？</h2><p class="small dim">退出しても、60秒以内ならページを開き直して復帰できます。その間アバターは動きません（AIが代わりに動くことはありません）。</p><button class="btn-main" id="m-ok">退出する</button><button class="btn-sub" id="m-no">続ける</button>`);
    m.querySelector('#m-no')!.addEventListener('click', () => m.remove());
    m.querySelector('#m-ok')!.addEventListener('click', () => {
      m.remove(); this.net.send({ t: 'leave' }); this.game?.stop(); this.game = null; this.room = null;
      this.input.enabled = false; this.showMenu();
    });
  }

  private onEnd(e: EndMsg) {
    this.lastEnd = e;
    clearInterval(this.introTimer);
    const g = this.game; this.game = null; g?.stop();
    this.input.enabled = false; this.input.unlockPointer();
    document.querySelectorAll('.modal').forEach((m) => m.remove());
    this.sfx.startMusic();
    this.showResults();
  }

  showResults() {
    const e = this.lastEnd!, init = this.lastInit; if (!init) return;
    const me = init.you, my = e.stats.find((s) => s.i === me);
    const survWin = e.result === 'survivors';
    const won = e.result === 'aborted' ? null : init.role === 'K' ? !survWin : survWin;
    const p = this.profile;
    const rows = e.stats.map((s) => {
      const pl = init.players.find((x) => x.id === s.i);
      const you = s.i === me;
      return `<tr class="${you ? 'hl' : ''}"><td>${esc(s.name)}${you ? '（あなた）' : ''}</td><td>${s.role === 'K' ? KILLERS[e.killer].name : '生存者'}</td><td>${STATE_JP[s.state] ?? esc(s.state)}</td><td>${s.gens}</td><td>${s.rescues}</td><td>${s.caps}</td><td>${you || !pl ? '' : `<span class="rp" style="cursor:pointer;color:var(--acc);text-decoration:underline" data-a="player" data-pub="${pl.pub}" data-name="${esc(s.name)}">通報/ミュート</span>`}</td></tr>`;
    }).join('');
    const a = p ? levelStartXp(p.level) : 0, b = p ? levelStartXp(p.level + 1) : 1;
    const pct = p ? Math.max(0, Math.min(100, ((p.xp - a) / Math.max(1, b - a)) * 100)) : 0;
    this.scene.set('title');
    this.show('results', `
      <div class="big ${won === null ? '' : won ? 'win' : 'lose'}">${e.result === 'aborted' ? '試合が中断されました' : won ? 'VICTORY' : 'DEFEAT'}</div>
      <p class="small">${e.result === 'survivors' ? `生存者の勝利（脱出 ${e.escaped} 人）` : e.result === 'killer' ? `キラーの勝利（脱出 ${e.escaped} 人）` : '人数が足りなくなったため中断されました'}　キラー: ${KILLERS[e.killer].name}</p>
      <table class="res"><tr><th>名前</th><th>役割</th><th>結果</th><th>修理</th><th>救助</th><th>捕獲</th><th></th></tr>${rows}</table>
      <div class="panel wide"><div>${e.rewards.lines.map((l) => `<div>${esc(l)}</div>`).join('')}<b style="color:var(--warn)">合計 +${e.rewards.xp} XP</b>${e.rewards.levelUp ? ` <b class="win">LEVEL UP! Lv.${e.rewards.level}</b>` : ''}</div>${p ? `<div class="xpbar"><i id="xpfill" style="width:0"></i></div><div class="small dim">Lv.${p.level}　${p.xp - a} / ${b - a} XP</div>` : ''}</div>
      <div class="menu"><button class="btn-main" data-a="afterresults">${this.room ? 'ロビーに戻る' : 'メニューに戻る'}</button></div>`, 'solid');
    void my;
    requestAnimationFrame(() => { const f = document.getElementById('xpfill'); if (f) f.style.width = pct + '%'; });
  }

  // ------------------------------------------------------------------ report / mute
  playerMenu(pub: string, name: string) {
    const muted = this.muted.has(pub);
    const m = this.modal(`<h2>${esc(name)}</h2><p class="small dim">通報はサーバーに記録され、運営が確認します。ブロックすると、そのプレイヤーのチャット表示が消え、クイックマッチでは同じルームを避けます。</p>
      <div class="menu" style="width:100%;margin:0">
      ${['不適切な名前', '迷惑行為・妨害', 'チート・不正の疑い', 'その他'].map((w) => `<button class="btn-sub" data-w="${w}">通報: ${w}</button>`).join('')}
      <button class="btn-sub" id="mm">${muted ? 'ブロックを解除' : 'ミュート / ブロックする'}</button><button class="btn-sub" id="mc">閉じる</button></div>`);
    m.querySelectorAll<HTMLElement>('[data-w]').forEach((b) => b.addEventListener('click', () => { this.net.send({ t: 'report', pub, why: b.dataset.w! }); m.remove(); }));
    m.querySelector('#mm')!.addEventListener('click', () => { if (muted) this.muted.delete(pub); else this.muted.add(pub); this.saveMuted(); this.toast(muted ? 'ブロックを解除しました' : 'ミュート/ブロックしました'); m.remove(); });
    m.querySelector('#mc')!.addEventListener('click', () => m.remove());
  }

  // ------------------------------------------------------------------ layout editor (touch)
  startLayoutEdit() {
    this.hide(); this.scene.set('title');
    document.body.dataset.input = 'touch'; document.body.dataset.screen = 'edit'; $('touch').classList.remove('hidden');
    this.input.setEditing(true); this.input.setRole(this.editRole);
    const bar = document.createElement('div'); bar.id = 'editbar';
    bar.innerHTML = '<button data-e="role">生存者/キラー切替</button><button data-e="reset">リセット</button><button data-e="done" style="border-color:var(--ok)">完了</button>';
    document.body.appendChild(bar);
    bar.addEventListener('click', (ev) => {
      const e = (ev.target as HTMLElement).dataset.e;
      if (e === 'role') { this.editRole = this.editRole === 'S' ? 'K' : 'S'; this.input.setRole(this.editRole); }
      else if (e === 'reset') this.input.resetLayout();
      else if (e === 'done') { bar.remove(); this.input.setEditing(false); $('touch').classList.add('hidden'); document.body.dataset.screen = 'menu'; this.input.setRole('S'); this.settingsBack = 'menu'; this.showSettings(); }
    });
  }

  // ------------------------------------------------------------------ actions
  act(a: string, el: HTMLElement) {
    const net = this.net;
    switch (a) {
      case 'enter': void this.enter(); break;
      case 'reload': location.reload(); break;
      case 'menu': this.showMenu(); break;
      case 'play': this.showPlay(); break;
      case 'quick': net.send({ t: 'quick' }); break;
      case 'custom': this.showCustom(); break;
      case 'create': net.send({ t: 'create' }); break;
      case 'join': { const c = (($('code') as HTMLInputElement)?.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length !== 4) return this.toast('4文字のルームコードを入力してください', true); net.send({ t: 'join', code: c }); break; }
      case 'leave': net.send({ t: 'leave' }); this.room = null; this.showPlay(); break;
      case 'char': net.send({ t: 'pick', char: Number(el.dataset.c) }); break;
      case 'map': net.send({ t: 'setmap', map: el.dataset.m as MapId | 'random' }); break;
      case 'start': net.send({ t: 'start' }); break;
      case 'copy': { const url = `${location.origin}${location.pathname}?room=${this.room?.code ?? ''}`; (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => this.toast('リンクをコピーしました'), () => this.toast(`ルームコード: ${this.room?.code}`)); break; }
      case 'ksel': this.pickSel = Number(el.dataset.i); this.scene.set('killers', this.pickSel); this.renderPick(); break;
      case 'kpick': if (!this.pickSent) { this.pickSent = true; net.send({ t: 'killer', id: KILLER_IDS[this.pickSel] }); this.renderPick(); } break;
      case 'collection': this.collSel = 0; this.showCollection(); break;
      case 'ctab': this.collTab = el.dataset.t as typeof this.collTab; this.collSel = 0; this.showCollection(); break;
      case 'csel': this.collSel = Number(el.dataset.i); this.showCollection(); break;
      case 'cprev': this.collSel--; this.showCollection(); break;
      case 'cnext': this.collSel++; this.showCollection(); break;
      case 'profile': if (this.profile) this.showProfile(); break;
      case 'settings': this.settingsBack = 'menu'; this.showSettings(); break;
      case 'credits': this.showCredits(); break;
      case 'backgame': this.hide(); break;
      case 'unmute': this.muted.clear(); this.saveMuted(); this.showSettings(); break;
      case 'layout': this.startLayoutEdit(); break;
      case 'layoutreset': this.input.resetLayout(); this.toast('ボタン配置をリセットしました'); break;
      case 'player': this.playerMenu(el.dataset.pub!, el.dataset.name ?? ''); break;
      case 'rename': {
        const nn = (($('newname') as HTMLInputElement).value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
        if (!nn) return;
        this.safeSet('pn2_name' + PROFILE_SUFFIX, nn); this.net.close();
        this.show('connecting', '<div class="eye"></div><div class="big">UPDATING</div><div class="load"><i></i></div>', 'glass');
        setTimeout(() => { this.net.connect(nn).then(() => { this.toast(nn === this.profile?.name ? '名前を変更しました' : '名前を更新しました（フィルタにより変更された場合があります）'); this.showProfile(); }).catch(() => this.showLost('再接続できませんでした')); }, 400);
        break;
      }
      case 'wipe': {
        const m = this.modal('<h2>データを削除</h2><p class="small dim">このブラウザに保存された設定・ログイン用トークンを削除します。サーバー上の進行状況はこのブラウザから二度と読み込めなくなります（サーバー側データの削除は運営への依頼が必要です。プライバシーポリシー参照）。</p><button class="btn-main" id="w-ok">削除してリロード</button><button class="btn-sub" id="w-no">キャンセル</button>');
        m.querySelector('#w-no')!.addEventListener('click', () => m.remove());
        m.querySelector('#w-ok')!.addEventListener('click', () => { try { localStorage.clear(); } catch { /* */ } location.reload(); });
        break;
      }
      case 'afterresults': this.lastEnd = null; this.cur = ''; if (this.room) { this.lobbyKey = ''; this.onRoom(this.room); } if (!this.cur) this.showMenu(); break;
    }
  }
}

void CHAT_PRESETS;

'use strict';
/* TwoSeats: 1:1 movie night over WebRTC.
 *
 * Media layout on the peer connection
 *   face audio + face video  (sendrecv, created by the "initiator" peer)
 *   movie video + movie audio (sendonly, added by whoever streams a movie)
 *   data channel "app" (negotiated id 0): chat, reactions, playback control,
 *     subtitles, and renegotiation once connected (so the call survives the
 *     signaling server sleeping).
 */
(() => {
  // ------------------------------------------------------------------ helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k) { try { return localStorage.getItem('twoseats.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('twoseats.' + k, v); } catch {} },
  };
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };
  const randId = (n) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return [...a].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  };

  // ------------------------------------------------------------------ icons
  const ICONS = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
    micOff: '<path d="M15 9.4V6a3 3 0 0 0-5.7-1.3"/><path d="M9 9v2a3 3 0 0 0 5 2.2"/><path d="M18.5 11a6.5 6.5 0 0 1-.9 3.3M5.5 11a6.5 6.5 0 0 0 10.4 5.2"/><path d="M12 17.5V21"/><path d="M3 3l18 18"/>',
    cam: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/>',
    camOff: '<path d="M10 6h3a2.5 2.5 0 0 1 2.5 2.5v3l6-4v10"/><path d="M15.5 15.5V16a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 16V8.5A2.5 2.5 0 0 1 4.6 6"/><path d="M3 3l18 18"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7.5 3v18M16.5 3v18M3 8h4.5M3 16h4.5M16.5 8H21M16.5 16H21M3 12h18"/>',
    screen: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
    chat: '<path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-4.9A8 8 0 1 1 20.5 11.5z"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    expand: '<path d="M8 3.5H3.5V8M16 3.5h4.5V8M8 20.5H3.5V16M16 20.5h4.5V16"/>',
    shrink: '<path d="M3.5 8H8V3.5M20.5 8H16V3.5M3.5 16H8v4.5M20.5 16H16v4.5"/>',
    leave: '<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M9.5 16.5L5 12l4.5-4.5M5 12h10"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
    back10: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><text x="12.6" y="15.4" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">10</text>',
    fwd10: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><text x="11.4" y="15.4" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">10</text>',
    link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3"/>',
    pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none"/>',
    subs: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6.5 14.5h4M13.5 14.5h4M6.5 11h7"/>',
    send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20.5V16h-4.5"/>',
  };
  const svg = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  function setIcon(el, name) {
    el.dataset.icon = name;
    const old = el.querySelector(':scope > svg.i');
    if (old) old.outerHTML = svg(name);
    else el.insertAdjacentHTML('afterbegin', svg(name));
  }
  function paintIcons(root = document) {
    $$('[data-icon]', root).forEach((el) => setIcon(el, el.dataset.icon));
    $$('[data-icon-left]', root).forEach((el) => {
      if (!el.querySelector(':scope > svg.i')) el.insertAdjacentHTML('afterbegin', svg(el.dataset.iconLeft));
    });
  }

  // ------------------------------------------------------------------ platform
  const UA = navigator.userAgent;
  const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_MOBILE = IS_IOS || /Android|Mobi/i.test(UA);
  const IS_CHROMIUM = !!window.chrome;
  const CAN_SCREEN = !IS_MOBILE && !!navigator.mediaDevices?.getDisplayMedia;
  const CAN_FILE = !IS_MOBILE && ('captureStream' in HTMLMediaElement.prototype || 'mozCaptureStream' in HTMLMediaElement.prototype);
  const CAN_HOST = CAN_SCREEN || CAN_FILE;
  const VOLUME_WORKS = (() => { try { const a = document.createElement('audio'); a.volume = 0.5; return a.volume === 0.5; } catch { return false; } })();
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);
  const FORCE_RELAY = params.get('relay') === '1';

  const PRESETS = {
    ultra: { label: '1080p, 60 fps, extra sharp (16 Mbps)', h: 1080, fps: 60, kbps: 16000 },
    '1080p60': { label: '1080p, 60 fps (10 Mbps)', h: 1080, fps: 60, kbps: 10000 },
    '1080p30': { label: '1080p, 30 fps (6 Mbps)', h: 1080, fps: 30, kbps: 6000 },
    '720p60': { label: '720p, 60 fps (5 Mbps)', h: 720, fps: 60, kbps: 5000 },
    '720p30': { label: '720p, 30 fps (2.5 Mbps)', h: 720, fps: 30, kbps: 2500 },
    '480p30': { label: '480p, data saver (1.2 Mbps)', h: 480, fps: 30, kbps: 1200 },
  };
  const ROOM_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

  // ------------------------------------------------------------------ state
  const S = {
    clientId: randId(20),
    name: '', room: '', inRoom: false, left: false,
    ws: null, wsBackoff: 1000,
    latestPair: null, latestPeerId: null, latestPeerName: '',
    iceServers: null,
    micTrack: null, camTrack: null, micOn: true, camOn: true, faceStream: new MediaStream(),
    P: null,
    partner: { here: false, name: '', mic: true, cam: true },
    partnerMovie: null,
    remotePlayback: null,
    movie: {
      active: false, mode: null, title: '', outStream: new MediaStream(), videoOut: null, audioOut: null,
      ctx: null, gain: null, dest: null, src: null, screenStream: null, captured: null, objectUrl: null, audioCheck: null,
    },
    movieGain: 1,
    preset: PRESETS[store.get('preset')] ? store.get('preset') : '1080p60',
    codec: store.get('codec') || 'h264',
    subs: null, subOffset: 0, lastSub: null, subTimer: null, subDelayMs: 180,
    unread: 0, idleTimer: null, seeking: false, countdownTimer: null, pipWin: null, wakeLock: null,
    stat: { out: null, in: null }, warnedNoTurn: false,
  };

  // ------------------------------------------------------------------ DOM
  const el = {};
  [
    'lobby', 'room', 'stage', 'preview', 'previewOff', 'joinForm', 'nameInput', 'roomInput', 'newRoomBtn', 'joinMic', 'joinCam', 'joinBtn', 'lobbyMsg', 'lobbyHint',
    'localMovie', 'remoteMovie', 'emptyStage', 'emptyTitle', 'emptyText', 'emptyInvite', 'emptyFile', 'emptyScreen', 'seatThem', 'screenNotice', 'popoutBtn2', 'stopShare2',
    'subtitle', 'reactionLayer', 'countdown', 'tapToPlay', 'bubbles', 'partnerBubble', 'partnerCam', 'partnerAvatar', 'partnerMicOff', 'partnerNameTag',
    'selfBubble', 'selfCam', 'selfAvatar', 'toasts', 'partnerAudio', 'topbar', 'connText', 'connRoute', 'miniSeatThem', 'inviteBtn',
    'playerBar', 'pbToggle', 'pbBack', 'pbFwd', 'pbTime', 'pbSeek', 'pbDur', 'pbCountdown',
    'controls', 'micBtn', 'camBtn', 'fileBtn', 'screenBtn', 'stopShareBtn', 'reactBtn', 'chatBtn', 'chatBadge', 'settingsBtn', 'fsBtn', 'leaveBtn',
    'reactTray', 'chatPanel', 'chatList', 'chatForm', 'chatInput', 'settingsPanel', 'qualitySel', 'qualityNote', 'codecSel',
    'movieVol', 'movieVolOut', 'voiceVol', 'voiceVolOut', 'voiceVolRow', 'localVol', 'localVolOut', 'echoSafe', 'subsSection', 'subLoadBtn', 'subClearBtn', 'subName',
    'subEarlier', 'subLater', 'subOffsetOut', 'subSize', 'allowControl', 'popoutBtn', 'statsToggle', 'stats', 'fileInput', 'subInput',
  ].forEach((id) => (el[id] = document.getElementById(id)));

  // ------------------------------------------------------------------ toasts
  function toast(html, { ms = 4200, warn = false } = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (warn ? ' warn' : '');
    t.innerHTML = html;
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 4) el.toasts.firstElementChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
    return t;
  }
  const pname = () => esc(S.partner.name || S.latestPeerName || 'Your partner');

  // ------------------------------------------------------------------ room codes
  const ADJ = ['velvet', 'golden', 'cozy', 'midnight', 'starry', 'sleepy', 'lucky', 'sunny', 'misty', 'silver', 'honey', 'quiet', 'rosy', 'amber', 'lunar', 'dreamy', 'sweet', 'mellow', 'cherry', 'warm'];
  const NOUN = ['popcorn', 'balcony', 'matinee', 'marquee', 'reel', 'ticket', 'encore', 'premiere', 'curtain', 'sofa', 'blanket', 'cinema', 'nacho', 'soda', 'comet', 'moon', 'otter', 'panda', 'fox', 'lantern'];
  const pick = (a) => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];
  const newRoomCode = () => `${pick(ADJ)}-${pick(NOUN)}-${randId(4)}`;
  const inviteUrl = () => `${location.origin}/r/${S.room}`;

  // ------------------------------------------------------------------ local media
  async function getMic() {
    if (S.micTrack && S.micTrack.readyState === 'live') return S.micTrack;
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    S.micTrack = s.getAudioTracks()[0];
    S.micTrack.enabled = S.micOn;
    return S.micTrack;
  }
  async function getCam() {
    if (S.camTrack && S.camTrack.readyState === 'live') return S.camTrack;
    const s = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
    });
    S.camTrack = s.getVideoTracks()[0];
    S.camTrack.onended = () => { if (S.camOn) setCam(false); };
    return S.camTrack;
  }
  function stopCam() {
    if (S.camTrack) { S.camTrack.onended = null; S.camTrack.stop(); }
    S.camTrack = null;
  }
  function mediaError(kind, err) {
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return `${kind} access is blocked. Allow it in the browser's site settings, then try again.`;
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return `No ${kind.toLowerCase()} found on this device.`;
    if (n === 'NotReadableError') return `Another app is using the ${kind.toLowerCase()}. Close it and try again.`;
    if (!window.isSecureContext) return 'This page needs HTTPS for the camera and microphone. Open it through your Render URL.';
    return `${kind} isn't available: ${err?.message || n || 'unknown error'}`;
  }

  // ------------------------------------------------------------------ lobby
  async function refreshPreview() {
    if (el.joinCam.checked) {
      try {
        const t = await getCam();
        el.preview.srcObject = new MediaStream([t]);
        el.previewOff.classList.add('hidden');
        if (el.lobbyMsg.dataset.cam) { el.lobbyMsg.textContent = ''; delete el.lobbyMsg.dataset.cam; }
      } catch (err) {
        el.previewOff.classList.remove('hidden');
        el.previewOff.textContent = 'Camera unavailable';
        el.lobbyMsg.textContent = mediaError('Camera', err);
        el.lobbyMsg.dataset.cam = '1';
      }
    } else {
      stopCam();
      el.preview.srcObject = null;
      el.previewOff.textContent = 'Camera is off';
      el.previewOff.classList.remove('hidden');
    }
  }

  function initLobby() {
    paintIcons();
    el.nameInput.value = store.get('name') || '';
    const fromPath = (location.pathname.match(/^\/r\/([A-Za-z0-9-]+)/) || [])[1];
    const code = (fromPath || params.get('room') || store.get('lastRoom') || newRoomCode()).toLowerCase();
    el.roomInput.value = code;
    if (fromPath) el.lobbyHint.textContent = `You're invited to ${code}. Add your name and take your seat.`;
    if (params.get('full')) {
      el.lobbyMsg.textContent = `${params.get('full')} already has two people in it. Make a new room code and send the new link.`;
      el.roomInput.value = newRoomCode();
      try { history.replaceState(null, '', '/'); } catch {}
    }
    el.joinMic.checked = store.get('mic') !== '0';
    el.joinCam.checked = store.get('cam') !== '0';
    el.newRoomBtn.onclick = () => { el.roomInput.value = newRoomCode(); };
    el.joinCam.onchange = () => { store.set('cam', el.joinCam.checked ? '1' : '0'); refreshPreview(); };
    el.joinMic.onchange = () => store.set('mic', el.joinMic.checked ? '1' : '0');
    el.joinForm.onsubmit = (e) => { e.preventDefault(); join(); };
    if (!window.RTCPeerConnection) {
      el.lobbyMsg.textContent = 'This browser can’t make video calls. Use Safari on iPhone, or Chrome or Edge on a computer.';
      el.joinBtn.disabled = true;
      return;
    }
    if (!navigator.mediaDevices) {
      el.lobbyMsg.textContent = 'Camera and microphone need HTTPS. Open the app through your Render URL.';
    }
    if (navigator.mediaDevices) refreshPreview();
    if (!el.nameInput.value) el.nameInput.focus();
  }

  async function join() {
    const name = el.nameInput.value.trim().slice(0, 24);
    const room = el.roomInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) { el.lobbyMsg.textContent = 'Add your name so your partner knows it’s you.'; return; }
    if (!ROOM_RE.test(room)) { el.lobbyMsg.textContent = 'Room codes use 3–40 letters, numbers or dashes.'; return; }
    S.name = name; S.room = room;
    store.set('name', name); store.set('lastRoom', room);
    el.joinBtn.disabled = true;
    el.lobbyMsg.className = 'msg info';
    el.lobbyMsg.textContent = 'Getting your seat ready…';

    S.micOn = el.joinMic.checked;
    S.camOn = el.joinCam.checked;
    if (navigator.mediaDevices) {
      // Ask for the mic even when joining muted, so unmuting later is instant and iOS lets audio autoplay.
      try { await getMic(); S.micTrack.enabled = S.micOn; } catch (err) { S.micOn = false; toast(esc(mediaError('Microphone', err)), { warn: true, ms: 7000 }); }
      if (S.camOn) { try { await getCam(); } catch (err) { S.camOn = false; toast(esc(mediaError('Camera', err)), { warn: true, ms: 7000 }); } }
      else stopCam();
    } else { S.micOn = false; S.camOn = false; }

    try {
      const r = await fetch('/api/ice', { cache: 'no-store' });
      S.iceServers = (await r.json()).iceServers;
    } catch {
      S.iceServers = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
    }
    // Unlock media elements while we still have the tap.
    [el.partnerAudio, el.remoteMovie].forEach((m) => m.play().catch(() => {}));
    enterRoom();
    connectWS();
  }

  // ------------------------------------------------------------------ room UI
  function enterRoom() {
    S.inRoom = true;
    el.preview.srcObject = null;
    el.lobby.classList.add('hidden');
    el.room.classList.remove('hidden');
    try { history.replaceState(null, '', `/r/${S.room}`); } catch {}
    document.title = `TwoSeats · ${S.room}`;
    $$('.host-only').forEach((n) => n.classList.toggle('hidden', !CAN_HOST));
    if (!CAN_FILE) { el.fileBtn.classList.add('hidden'); el.emptyFile.classList.add('hidden'); el.subsSection.classList.add('hidden'); }
    if (!CAN_SCREEN) { el.screenBtn.classList.add('hidden'); el.emptyScreen.classList.add('hidden'); }
    if (!VOLUME_WORKS) el.voiceVolRow.classList.add('hidden');
    el.selfAvatar.textContent = (S.name[0] || '?').toUpperCase();
    // settings
    el.qualitySel.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
    el.qualitySel.value = S.preset;
    el.codecSel.value = S.codec;
    const subScale = Number(store.get('subSize')) || 100;
    el.subSize.value = subScale;
    document.documentElement.style.setProperty('--sub-scale', subScale / 100);
    refreshSelf();
    refreshControls();
    updateStage();
    updateConn();
    keepAwake();
    poke();
    setInterval(pollStats, 1000);
    setInterval(detectSpeaking, 300);
    setInterval(renderPlayerBar, 250);
    setInterval(() => wsSend({ type: 'ping' }), 25000);
    setTimeout(() => { if (!S.P) toast('Send the invite link to your partner. Their seat is saved.', { ms: 5000 }); }, 1500);
  }

  function refreshSelf() {
    if (S.camOn && S.camTrack) {
      el.selfCam.srcObject = new MediaStream([S.camTrack]);
      el.selfBubble.classList.remove('cam-off');
    } else {
      el.selfCam.srcObject = null;
      el.selfBubble.classList.add('cam-off');
    }
  }

  function refreshControls() {
    el.micBtn.classList.toggle('off', !S.micOn);
    setIcon(el.micBtn, S.micOn ? 'mic' : 'micOff');
    el.micBtn.querySelector('span').textContent = S.micOn ? 'Mute' : 'Unmute';
    el.micBtn.setAttribute('aria-pressed', String(!S.micOn));
    el.camBtn.classList.toggle('off', !S.camOn);
    setIcon(el.camBtn, S.camOn ? 'cam' : 'camOff');
    el.camBtn.querySelector('span').textContent = S.camOn ? 'Camera' : 'Camera off';
    el.fileBtn.classList.toggle('on', S.movie.active && S.movie.mode === 'file');
    el.screenBtn.classList.toggle('on', S.movie.active && S.movie.mode === 'screen');
    el.stopShareBtn.classList.toggle('hidden', !S.movie.active);
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    setIcon(el.fsBtn, fs ? 'shrink' : 'expand');
  }

  const watchingFile = () => (S.movie.active && S.movie.mode === 'file') || (!S.movie.active && S.partnerMovie?.active && S.partnerMovie.mode === 'file');
  const isWatching = () => (S.movie.active && S.movie.mode === 'file') || (!S.movie.active && !!S.partnerMovie?.active);

  function updateStage() {
    const mineFile = S.movie.active && S.movie.mode === 'file';
    const mineScreen = S.movie.active && S.movie.mode === 'screen';
    const theirs = !S.movie.active && !!S.partnerMovie?.active;
    el.localMovie.classList.toggle('hidden', !mineFile);
    el.remoteMovie.classList.toggle('hidden', !theirs);
    el.screenNotice.classList.toggle('hidden', !mineScreen);
    const movieOn = mineFile || mineScreen || theirs;
    const here = S.partner.here;
    el.emptyStage.classList.toggle('hidden', movieOn || here);
    el.room.classList.toggle('call-mode', !movieOn && here);
    if (!movieOn && here) el.bubbles.removeAttribute('style');
    el.partnerBubble.classList.toggle('absent', !here);
    el.playerBar.classList.toggle('hidden', !watchingFile());
    if (!movieOn) showSubtitle('');
    if (theirs) playEl(el.remoteMovie);
    refreshControls();
    poke();
  }

  function updateConn() {
    const P = S.P;
    const name = S.partner.name || S.latestPeerName || 'your partner';
    const wsUp = S.ws && S.ws.readyState === 1;
    let text;
    let connected = false;
    if (P) {
      const st = P.pc.connectionState;
      if (st === 'connected') { text = `${name} is here`; connected = true; }
      else if (st === 'failed') text = `Can't reach ${name}, retrying`;
      else if (st === 'disconnected') text = `Lost ${name} for a moment, reconnecting`;
      else text = `Connecting to ${name}`;
    } else text = wsUp ? 'Waiting for your partner' : 'Connecting to the server';
    el.connText.textContent = text;
    el.miniSeatThem.classList.toggle('taken', connected);
    el.seatThem.classList.toggle('taken', !!P);
    if (P && !connected) {
      el.emptyTitle.textContent = `Connecting to ${name}`;
      el.emptyText.textContent = 'This usually takes a couple of seconds.';
    } else if (!P) {
      el.emptyTitle.textContent = "Your partner's seat is saved";
      el.emptyText.textContent = wsUp
        ? "Send them the invite link. You'll connect as soon as they open it."
        : 'Waking up the server. On a free Render plan the first visit can take up to a minute.';
    }
    if (!connected) el.connRoute.classList.add('hidden');
  }

  // ------------------------------------------------------------------ signaling (WebSocket)
  function wsSend(msg) {
    if (S.ws && S.ws.readyState === 1) { try { S.ws.send(JSON.stringify(msg)); return true; } catch {} }
    return false;
  }

  function connectWS() {
    if (S.left) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    S.ws = ws;
    ws.onopen = () => {
      S.wsBackoff = 1000;
      wsSend({ type: 'join', room: S.room, clientId: S.clientId, name: S.name });
      updateConn();
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onWS(m);
    };
    ws.onclose = (e) => {
      if (S.ws !== ws) return;
      S.ws = null;
      updateConn();
      if (S.left || e.code === 4000) return;
      setTimeout(connectWS, S.wsBackoff);
      S.wsBackoff = Math.min(S.wsBackoff * 2, 15000);
    };
    ws.onerror = () => {};
  }

  function onWS(m) {
    switch (m.type) {
      case 'joined':
        updateConn();
        break;
      case 'full':
        S.left = true;
        try { S.ws.close(); } catch {}
        location.href = `/?full=${encodeURIComponent(S.room)}`;
        break;
      case 'ready': {
        S.latestPair = m.pairId;
        S.latestPeerId = m.peerId;
        S.latestPeerName = m.peerName || '';
        const P = S.P;
        if (P && P.peerId === m.peerId && P.pc.connectionState === 'connected') break; // still talking directly; keep it
        createPeer(m.peerId, m.pairId);
        break;
      }
      case 'peer-left': {
        const P = S.P;
        if (!P || P.peerId !== m.peerId) break;
        if (P.pc.connectionState !== 'connected') { closePeer(); toast(`${pname()} left.`); }
        break;
      }
      case 'signal':
        handleSignal(m.data);
        break;
      case 'error':
        toast(esc(m.message || 'Server error'), { warn: true });
        break;
    }
  }

  let sigSeq = 0;
  const seen = new Set();
  const seenOrder = [];
  function sendSignal(payload) {
    const P = S.P;
    if (!P) return;
    const data = { ...payload, pairId: P.pairId, sid: `${S.clientId}:${++sigSeq}` };
    // Send on both paths: the data channel survives server restarts, the
    // WebSocket survives a broken peer connection. Receiver de-duplicates.
    if (P.dc && P.dc.readyState === 'open') { try { P.dc.send(JSON.stringify({ type: 'sig', data })); } catch {} }
    wsSend({ type: 'signal', data });
  }

  function handleSignal(data) {
    if (!data || !data.sid || seen.has(data.sid)) return;
    seen.add(data.sid);
    seenOrder.push(data.sid);
    if (seenOrder.length > 2000) seen.delete(seenOrder.shift());
    if (!S.P || data.pairId !== S.P.pairId) {
      if (data.pairId && data.pairId === S.latestPair && S.latestPeerId) createPeer(S.latestPeerId, data.pairId);
      else return; // stale message from an older connection
    }
    const P = S.P;
    P.queue = P.queue.then(() => processSignal(P, data)).catch((err) => console.warn('[signal]', err));
  }

  // ------------------------------------------------------------------ SDP tweaks
  function tuneRemoteSdp(sdp) {
    // Stereo, high-bitrate Opus so the movie soundtrack isn't squashed into "phone call" audio.
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
    if (m) {
      const pt = m[1];
      sdp = sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g'), (_, p) => {
        const kv = p.split(';').map((s) => s.trim()).filter((s) => s && !/^(stereo|sprop-stereo|maxaveragebitrate)=/i.test(s));
        kv.push('stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=256000');
        return `a=fmtp:${pt} ${kv.join(';')}`;
      });
    }
    if (IS_CHROMIUM) {
      // Start the video bandwidth estimate higher so 1080p sharpens in seconds rather than ~20 s.
      const pts = [...sdp.matchAll(/a=rtpmap:(\d+) (H264|VP9|AV1)\/90000/gi)].map((x) => x[1]);
      for (const pt of pts) {
        sdp = sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g'), (line, p) =>
          /x-google-start-bitrate/.test(p) ? line : `a=fmtp:${pt} ${p};x-google-start-bitrate=2500`);
      }
    }
    return sdp;
  }

  function applyCodecPrefs(tx) {
    if (!tx || !tx.setCodecPreferences) return;
    const want = { h264: 'video/h264', vp9: 'video/vp9', av1: 'video/av1', vp8: 'video/vp8' }[S.codec];
    const attempt = (caps) => {
      if (!caps || !caps.codecs || !caps.codecs.length) return false;
      if (!want) { tx.setCodecPreferences([]); return true; }
      const pref = caps.codecs.filter((c) => c.mimeType.toLowerCase() === want);
      if (!pref.length) return false;
      if (want === 'video/h264') {
        const score = (c) => (/packetization-mode=1/.test(c.sdpFmtpLine || '') ? 1 : 0);
        pref.sort((a, b) => score(b) - score(a));
      }
      const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== want);
      tx.setCodecPreferences([...pref, ...rest]);
      return true;
    };
    try { if (attempt(RTCRtpReceiver.getCapabilities && RTCRtpReceiver.getCapabilities('video'))) return; } catch {}
    try { if (attempt(RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities('video'))) return; } catch (err) { console.warn('[codec]', err); }
    if (want) toast(`This browser can't send ${esc(S.codec.toUpperCase())}. Using its default codec.`, { warn: true });
  }

  async function tuneSender(sender, o) {
    if (!sender || !sender.track) return;
    const build = (full) => {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) return null;
      const e = p.encodings[0];
      if (o.maxBitrate) e.maxBitrate = Math.round(o.maxBitrate);
      if (o.maxFramerate) e.maxFramerate = o.maxFramerate;
      if (o.scale) e.scaleResolutionDownBy = o.scale;
      if (full && o.priority) { e.priority = o.priority; e.networkPriority = o.priority; }
      if (full && o.degradation) p.degradationPreference = o.degradation;
      return p;
    };
    try {
      const p = build(true);
      if (p) await sender.setParameters(p);
    } catch {
      try { const p = build(false); if (p) await sender.setParameters(p); } catch (err) { console.warn('[tune]', err); }
    }
  }

  function tuneAllSenders() {
    const P = S.P;
    if (!P) return;
    tuneSender(P.faceV?.sender, { maxBitrate: 600000, maxFramerate: 24, priority: 'low' });
    tuneSender(P.faceA?.sender, { maxBitrate: 64000, priority: 'high' });
    tuneSender(P.movieA?.sender, { maxBitrate: 256000, priority: 'high' });
    tuneMovieVideo();
  }

  function tuneMovieVideo() {
    const P = S.P;
    const track = P?.movieV?.sender.track;
    if (!track) return;
    const pr = PRESETS[S.preset];
    let h = S.movie.mode === 'file' ? el.localMovie.videoHeight : 0;
    if (!h) h = (track.getSettings && track.getSettings().height) || pr.h;
    const scale = h > pr.h + 8 ? h / pr.h : 1;
    tuneSender(P.movieV.sender, { maxBitrate: pr.kbps * 1000, maxFramerate: pr.fps, scale, priority: 'high', degradation: 'balanced' });
  }

  // ------------------------------------------------------------------ peer connection
  function createPeer(peerId, pairId) {
    closePeer(true);
    const isInit = S.clientId < peerId;
    const pc = new RTCPeerConnection({
      iceServers: S.iceServers || [],
      iceTransportPolicy: FORCE_RELAY ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
    });
    const P = {
      pc, peerId, pairId, isInit, polite: !isInit, gotFirstOffer: isInit,
      makingOffer: false, ignoreOffer: false, srdAnswerPending: false,
      queue: Promise.resolve(), pendingCands: [],
      faceA: null, faceV: null, movieV: null, movieA: null, rxMovieV: null, rxMovieA: null,
      dc: null, restarts: 0, everConnected: false, discTimer: null,
    };
    S.P = P;

    pc.onicecandidate = (e) => { if (S.P === P && e.candidate) sendSignal({ candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.onnegotiationneeded = () => { if (S.P === P && P.gotFirstOffer) makeOffer(P); };
    pc.ontrack = (ev) => onTrack(P, ev);
    pc.onsignalingstatechange = () => { if (S.P === P && pc.signalingState === 'stable') tuneAllSenders(); };
    pc.onconnectionstatechange = () => onConnState(P);

    if (isInit) {
      P.faceA = pc.addTransceiver(S.micTrack || 'audio', { direction: 'sendrecv', streams: [S.faceStream] });
      P.faceV = pc.addTransceiver(S.camOn && S.camTrack ? S.camTrack : 'video', { direction: 'sendrecv', streams: [S.faceStream] });
      setupDC(P, pc.createDataChannel('app', { negotiated: true, id: 0 }));
      if (S.movie.active) addMovieTransceivers(P);
    }
    sendSignal({ created: true });
    updateConn();
    updateStage();
  }

  async function makeOffer(P) {
    if (S.P !== P) return;
    try {
      P.makingOffer = true;
      await P.pc.setLocalDescription();
      sendSignal({ description: P.pc.localDescription.toJSON ? P.pc.localDescription.toJSON() : P.pc.localDescription });
    } catch (err) {
      console.warn('[offer]', err);
    } finally {
      P.makingOffer = false;
    }
  }

  async function processSignal(P, data) {
    if (S.P !== P) return;
    const pc = P.pc;
    const { description, candidate } = data;
    if (description) {
      const readyForOffer = !P.makingOffer && (pc.signalingState === 'stable' || P.srdAnswerPending);
      const collision = description.type === 'offer' && !readyForOffer;
      P.ignoreOffer = !P.polite && collision;
      if (P.ignoreOffer) return;
      P.srdAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription({ type: description.type, sdp: tuneRemoteSdp(description.sdp) });
      P.srdAnswerPending = false;
      if (description.type === 'offer') {
        const first = !P.gotFirstOffer;
        if (first) { await attachAsAnswerer(P); P.gotFirstOffer = true; }
        await pc.setLocalDescription();
        sendSignal({ description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
        if (first && S.movie.active) addMovieTransceivers(P);
      }
      const queued = P.pendingCands.splice(0);
      for (const c of queued) { try { await pc.addIceCandidate(c); } catch {} }
    } else if (candidate) {
      if (!pc.remoteDescription) { P.pendingCands.push(candidate); return; }
      try { await pc.addIceCandidate(candidate); } catch (err) { if (!P.ignoreOffer) console.warn('[ice]', err.message); }
    }
  }

  function ensureFaceTx(P) {
    if (P.faceA && P.faceV) return;
    const ts = P.pc.getTransceivers();
    if (!P.faceA) P.faceA = ts.find((t) => t.receiver.track.kind === 'audio') || null;
    if (!P.faceV) P.faceV = ts.find((t) => t.receiver.track.kind === 'video') || null;
  }

  async function attachAsAnswerer(P) {
    ensureFaceTx(P);
    if (P.faceA) { P.faceA.direction = 'sendrecv'; await P.faceA.sender.replaceTrack(S.micTrack || null); }
    if (P.faceV) { P.faceV.direction = 'sendrecv'; await P.faceV.sender.replaceTrack(S.camOn ? S.camTrack : null); }
    setupDC(P, P.pc.createDataChannel('app', { negotiated: true, id: 0 }));
  }

  function addMovieTransceivers(P = S.P) {
    if (!P || !P.gotFirstOffer || P.movieV) return;
    P.movieV = P.pc.addTransceiver(S.movie.videoOut || 'video', { direction: 'sendonly', streams: [S.movie.outStream] });
    P.movieA = P.pc.addTransceiver(S.movie.audioOut || 'audio', { direction: 'sendonly', streams: [S.movie.outStream] });
    applyCodecPrefs(P.movieV);
  }

  function onTrack(P, ev) {
    if (S.P !== P) return;
    ensureFaceTx(P);
    const tx = ev.transceiver;
    const track = ev.track;
    if (tx === P.faceA) {
      el.partnerAudio.srcObject = new MediaStream([track]);
      playEl(el.partnerAudio);
    } else if (tx === P.faceV) {
      el.partnerCam.srcObject = new MediaStream([track]);
      track.onmute = track.onunmute = refreshPartner;
      playEl(el.partnerCam);
      refreshPartner();
    } else {
      if (track.kind === 'video') P.rxMovieV = tx; else P.rxMovieA = tx;
      const tracks = [P.rxMovieV?.receiver.track, P.rxMovieA?.receiver.track].filter(Boolean);
      el.remoteMovie.srcObject = new MediaStream(tracks);
      if (S.partnerMovie?.active) playEl(el.remoteMovie);
    }
  }

  function playEl(m) {
    if (!m.srcObject) return;
    const p = m.play();
    if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotAllowedError') el.tapToPlay.classList.remove('hidden'); });
  }

  function onConnState(P) {
    if (S.P !== P) return;
    const st = P.pc.connectionState;
    clearTimeout(P.discTimer);
    if (st === 'connected') {
      P.everConnected = true;
      P.restarts = 0;
      tuneAllSenders();
      nudgeFrame();
    } else if (st === 'disconnected') {
      P.discTimer = setTimeout(() => { if (S.P === P && P.pc.connectionState === 'disconnected') restartIce(P); }, 4000);
    } else if (st === 'failed') {
      restartIce(P);
    }
    updateConn();
  }

  function restartIce(P) {
    if (S.P !== P) return;
    P.restarts++;
    if (!P.everConnected && P.restarts >= 2 && !S.warnedNoTurn) {
      S.warnedNoTurn = true;
      toast("Can't make a direct connection between your networks (common on mobile data). Add a free TURN relay in Render; the README shows how.", { warn: true, ms: 12000 });
    }
    try { P.pc.restartIce(); } catch { makeOffer(P); }
  }

  function closePeer(silent) {
    const P = S.P;
    if (!P) return;
    S.P = null;
    clearTimeout(P.discTimer);
    try { P.dc && P.dc.close(); } catch {}
    try { P.pc.close(); } catch {}
    el.partnerAudio.srcObject = null;
    el.partnerCam.srcObject = null;
    el.remoteMovie.srcObject = null;
    S.partner.here = false;
    S.partnerMovie = null;
    S.remotePlayback = null;
    showSubtitle('');
    el.countdown.classList.add('hidden');
    if (!silent) { updateStage(); updateConn(); }
  }

  // ------------------------------------------------------------------ data channel
  function setupDC(P, dc) {
    P.dc = dc;
    dc.onopen = () => {
      if (S.P !== P) return;
      sendApp({ type: 'hello', name: S.name, mic: S.micOn, cam: S.camOn });
      if (S.movie.active) {
        sendApp({ type: 'movie', active: true, mode: S.movie.mode, title: S.movie.title });
        sendApp({ type: 'quality', preset: S.preset });
        sendApp({ type: 'gain', v: S.movieGain });
        if (S.movie.mode === 'file') { sendPlayback(); if (S.lastSub) sendApp({ type: 'sub', text: S.lastSub }); }
      }
    };
    dc.onclose = () => { if (S.P === P) updateConn(); };
    dc.onmessage = (e) => {
      if (S.P !== P) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onApp(m);
    };
  }

  function sendApp(msg) {
    const dc = S.P?.dc;
    if (dc && dc.readyState === 'open') { try { dc.send(JSON.stringify(msg)); return true; } catch {} }
    return false;
  }

  function onApp(m) {
    switch (m.type) {
      case 'sig':
        handleSignal(m.data);
        break;
      case 'hello': {
        const first = !S.partner.here;
        S.partner.here = true;
        S.partner.name = String(m.name || 'Partner').slice(0, 24);
        S.partner.mic = !!m.mic;
        S.partner.cam = !!m.cam;
        el.partnerNameTag.textContent = S.partner.name;
        el.partnerAvatar.textContent = (S.partner.name[0] || '?').toUpperCase();
        refreshPartner();
        updateConn();
        updateStage();
        if (first) { toast(`<b>${pname()}</b> took their seat.`); addChatSys(`${S.partner.name} joined`); }
        break;
      }
      case 'state':
        S.partner.mic = !!m.mic;
        S.partner.cam = !!m.cam;
        refreshPartner();
        break;
      case 'chat':
        addChat(String(m.text || '').slice(0, 1000), false, m.ts);
        break;
      case 'react':
        showReaction(String(m.emoji || '❤️').slice(0, 8), S.partner.name, m.x, m.y);
        break;
      case 'movie': {
        const was = S.partnerMovie?.active;
        S.partnerMovie = { active: !!m.active, mode: m.mode === 'screen' ? 'screen' : 'file', title: String(m.title || '').slice(0, 120) };
        if (m.active && S.movie.active) { stopMovie(); toast(`<b>${pname()}</b> started streaming, so yours stopped.`); }
        if (m.active && !was) toast(`<b>${pname()}</b> is streaming${S.partnerMovie.title ? ` <b>${esc(S.partnerMovie.title)}</b>` : ' their screen'}.`);
        if (!m.active) { S.remotePlayback = null; if (!S.movie.active) showSubtitle(''); }
        updateStage();
        break;
      }
      case 'playback':
        if (S.movie.active) break;
        S.remotePlayback = { paused: !!m.paused, t: Number(m.t) || 0, d: Number(m.d) || 0, rate: Number(m.rate) || 1, at: performance.now() };
        break;
      case 'control':
        applyControl(m, true);
        break;
      case 'sub':
        if (S.movie.active) break;
        { const text = String(m.text || '').slice(0, 2000); setTimeout(() => showSubtitle(text), S.subDelayMs); }
        break;
      case 'gain':
        S.movieGain = clamp(Number(m.v) || 0, 0, 1.5);
        el.movieVol.value = Math.round(S.movieGain * 100);
        el.movieVolOut.textContent = `${el.movieVol.value}%`;
        applyGain();
        break;
      case 'quality':
        if (!PRESETS[m.preset]) break;
        S.preset = m.preset;
        el.qualitySel.value = m.preset;
        store.set('preset', m.preset);
        if (S.movie.active) { syncFileTracks(); tuneMovieVideo(); if (m.from === 'viewer') toast(`<b>${pname()}</b> switched quality to ${esc(PRESETS[m.preset].label)}.`); }
        break;
      case 'countdown':
        showCountdown(Number(m.n) || 0);
        break;
      case 'notice':
        toast(esc(String(m.text || '').slice(0, 200)));
        break;
      case 'bye':
        toast(`${pname()} left.`);
        addChatSys(`${S.partner.name || 'Partner'} left`);
        closePeer();
        break;
    }
  }

  function refreshPartner() {
    const vt = el.partnerCam.srcObject && el.partnerCam.srcObject.getVideoTracks()[0];
    const camLive = S.partner.cam && vt && !vt.muted;
    el.partnerBubble.classList.toggle('cam-off', !camLive);
    el.partnerMicOff.classList.toggle('hidden', S.partner.mic);
    if (S.pipWin) refreshPip();
  }

  function detectSpeaking() {
    const P = S.P;
    if (!P || !P.faceA || !P.faceA.receiver.getSynchronizationSources) return;
    try {
      const src = P.faceA.receiver.getSynchronizationSources();
      const lvl = src.length ? src[0].audioLevel || 0 : 0;
      el.partnerBubble.classList.toggle('speaking', S.partner.mic && lvl > 0.05);
    } catch {}
  }

  // ------------------------------------------------------------------ mic / camera
  async function setMic(on) {
    if (on && !S.micTrack) {
      try { await getMic(); } catch (err) { toast(esc(mediaError('Microphone', err)), { warn: true }); return; }
      if (S.P?.faceA) await S.P.faceA.sender.replaceTrack(S.micTrack).catch(() => {});
    }
    S.micOn = on;
    if (S.micTrack) S.micTrack.enabled = on;
    refreshControls();
    sendApp({ type: 'state', mic: S.micOn, cam: S.camOn });
    if (S.pipWin) refreshPip();
  }

  async function setCam(on) {
    if (on) {
      try { await getCam(); } catch (err) { toast(esc(mediaError('Camera', err)), { warn: true }); return; }
    } else stopCam();
    S.camOn = on;
    if (S.P?.faceV) await S.P.faceV.sender.replaceTrack(on ? S.camTrack : null).catch(() => {});
    if (on) tuneSender(S.P?.faceV?.sender, { maxBitrate: 600000, maxFramerate: 24, priority: 'low' });
    refreshSelf();
    refreshControls();
    sendApp({ type: 'state', mic: S.micOn, cam: S.camOn });
  }

  // ------------------------------------------------------------------ movie streaming
  function ensureMovieAudio() {
    const M = S.movie;
    if (!M.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      M.ctx = new AC({ sampleRate: 48000 });
      M.gain = M.ctx.createGain();
      M.gain.gain.value = S.movieGain;
      M.dest = M.ctx.createMediaStreamDestination();
      M.dest.channelCount = 2;
      M.gain.connect(M.dest);
      M.audioOut = M.dest.stream.getAudioTracks()[0];
    }
    if (M.ctx.state !== 'running') M.ctx.resume().catch(() => {});
  }
  // Audio graph on the PC that streams:
  //   source ──► gain ──► dest              (what your partner hears; "Movie volume")
  //   source ──► localGain ──► loopback PC ──► <audio>   (what you hear, echo-safe)
  //                        └─► speakers directly          (echo-safe off)
  // Chrome's echo canceller reliably removes only audio that arrives over an RTCPeerConnection
  // from the mic. Sending our own playback through a loopback connection inside this page turns
  // the movie into that kind of audio, so speakers playing the movie no longer leak it into the
  // mic and your partner doesn't hear everything twice.
  function connectMovieAudio(source, playLocal) {
    const M = S.movie;
    if (M.src) { try { M.src.disconnect(); } catch {} M.src = null; }
    if (!source || !M.ctx) return;
    M.src = source instanceof AudioNode ? source : M.ctx.createMediaStreamSource(new MediaStream([source]));
    M.src.connect(M.gain);
    if (playLocal) { ensureLocalOut(); M.src.connect(M.localGain); }
  }

  const Echo = { a: null, b: null, dest: null, audio: null };
  function ensureLocalOut() {
    const M = S.movie;
    ensureMovieAudio();
    if (!M.localGain) {
      M.localGain = M.ctx.createGain();
      M.localGain.gain.value = Number(el.localVol.value) / 100;
      routeLocalOut();
    }
  }
  function routeLocalOut() {
    const M = S.movie;
    if (!M.localGain) return;
    try { M.localGain.disconnect(); } catch {}
    if (el.echoSafe.checked && startLoopback()) M.localGain.connect(Echo.dest);
    else { stopLoopback(); M.localGain.connect(M.ctx.destination); }
  }
  function startLoopback() {
    if (Echo.a) return true;
    if (!window.RTCPeerConnection) return false;
    const M = S.movie;
    Echo.dest = M.ctx.createMediaStreamDestination();
    Echo.dest.channelCount = 2;
    Echo.audio = new Audio();
    Echo.audio.autoplay = true;
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    Echo.a = a;
    Echo.b = b;
    a.onicecandidate = (e) => { if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {}); };
    b.onicecandidate = (e) => { if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {}); };
    b.ontrack = (e) => {
      try { e.receiver.jitterBufferTarget = 0; } catch {}
      Echo.audio.srcObject = new MediaStream([e.track]);
      Echo.audio.play().catch(() => {});
    };
    a.addTrack(Echo.dest.stream.getAudioTracks()[0]);
    (async () => {
      try {
        await a.setLocalDescription();
        await b.setRemoteDescription({ type: 'offer', sdp: tuneRemoteSdp(a.localDescription.sdp) });
        await b.setLocalDescription();
        await a.setRemoteDescription({ type: 'answer', sdp: tuneRemoteSdp(b.localDescription.sdp) });
        await tuneSender(a.getSenders()[0], { maxBitrate: 256000 });
      } catch (err) {
        console.warn('[echo-safe]', err);
        el.echoSafe.checked = false;
        routeLocalOut();
      }
    })();
    return true;
  }
  function stopLoopback() {
    if (!Echo.a) return;
    try { Echo.a.close(); Echo.b.close(); } catch {}
    if (Echo.audio) { Echo.audio.pause(); Echo.audio.srcObject = null; }
    Echo.a = Echo.b = Echo.dest = Echo.audio = null;
  }
  function applyGain() {
    const M = S.movie;
    if (M.gain) M.gain.gain.setTargetAtTime(S.movieGain, M.ctx.currentTime, 0.05);
  }

  async function setMovieVideo(track) {
    S.movie.videoOut = track;
    if (track) track.contentHint = 'motion';
    const P = S.P;
    if (!P) return;
    if (P.movieV) {
      await P.movieV.sender.replaceTrack(track).catch((e) => console.warn(e));
      await P.movieA.sender.replaceTrack(S.movie.audioOut).catch((e) => console.warn(e));
      tuneAllSenders();
    } else addMovieTransceivers(P);
  }

  let lastNudge = 0;
  function nudgeFrame() {
    // A paused <video> produces no frames, so a newly connected partner would see black. A
    // zero-length seek makes the browser emit the current frame again.
    const v = el.localMovie;
    if (!(S.movie.active && S.movie.mode === 'file' && v.paused && v.readyState >= 2)) return;
    const now = Date.now();
    if (now - lastNudge < 800) return;
    lastNudge = now;
    setTimeout(() => { try { v.currentTime = v.currentTime; } catch {} }, 300);
  }

  async function startFile(file) {
    if (!file) return;
    if (S.movie.active) stopMovie();
    ensureMovieAudio();
    const v = el.localMovie;
    const M = S.movie;
    if (M.objectUrl) URL.revokeObjectURL(M.objectUrl);
    M.objectUrl = URL.createObjectURL(file);
    M.title = file.name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim();
    clearSubs(true);
    v.src = M.objectUrl;
    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = () => res();
        v.onerror = () => rej(new Error('unsupported'));
      });
    } catch {
      toast("This browser can't play that file (often MKV with AC3/DTS sound). Use <b>Screen</b> with VLC instead, or convert it to MP4 (H.264 + AAC).", { warn: true, ms: 10000 });
      v.removeAttribute('src');
      v.load();
      return;
    }
    if (!M.captured) {
      M.captured = v.captureStream ? v.captureStream() : v.mozCaptureStream();
      M.captured.onaddtrack = syncFileTracks;
      M.captured.onremovetrack = syncFileTracks;
    }
    // The element's sound now flows only through our graph: one copy to your partner, one to you.
    if (!M.elemSrc) M.elemSrc = M.ctx.createMediaElementSource(v);
    v.volume = 1;
    v.muted = false;
    M.active = true;
    M.mode = 'file';
    connectMovieAudio(M.elemSrc, true);
    syncFileTracks(true);
    sendApp({ type: 'movie', active: true, mode: 'file', title: M.title });
    sendApp({ type: 'quality', preset: S.preset });
    sendPlayback();
    updateStage();
    toast(`Ready: <b>${esc(M.title)}</b>. Press play, or use <b>3, 2, 1, play</b>.`, { ms: 6000 });
    clearInterval(M.audioCheck);
    M.audioCheck = setInterval(() => {
      if (!M.active || M.mode !== 'file' || v.paused || v.currentTime < 3) return;
      clearInterval(M.audioCheck);
      if (v.webkitAudioDecodedByteCount === 0 || v.mozHasAudio === false) {
        toast("This file's sound can't be decoded by the browser (often AC3/DTS). Use <b>Screen</b> with VLC instead, or convert the audio to AAC.", { warn: true, ms: 12000 });
      }
    }, 1000);
  }

  // Chrome caps <video>.captureStream() at 30 fps. For 60 fps presets we forward every decoded
  // frame ourselves: requestVideoFrameCallback -> MediaStreamTrackGenerator (or a canvas fallback).
  // rVFC only fires while the tab is visible, so a hidden tab falls back to captureStream.
  function startFrameRelay() {
    const M = S.movie;
    const v = el.localMovie;
    if (M.relay) return M.relay.track;
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return null;
    let track;
    let push;
    try {
      if (window.MediaStreamTrackGenerator && window.VideoFrame) {
        const gen = new MediaStreamTrackGenerator({ kind: 'video' });
        const writer = gen.writable.getWriter();
        track = gen;
        push = () => {
          if (writer.desiredSize !== null && writer.desiredSize <= 0) return; // encoder busy: drop this frame
          let f;
          try { f = new VideoFrame(v, { timestamp: Math.round(performance.now() * 1000) }); } catch { return; }
          writer.write(f).catch(() => { try { f.close(); } catch {} });
        };
      } else {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d', { alpha: false });
        track = c.captureStream(0).getVideoTracks()[0];
        if (!track.requestFrame) return null;
        push = () => {
          if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
          ctx.drawImage(v, 0, 0);
          track.requestFrame();
        };
      }
    } catch (err) {
      console.warn('[relay]', err);
      return null;
    }
    const relay = { track, handle: 0 };
    const loop = () => {
      if (M.relay !== relay) return;
      push();
      relay.handle = v.requestVideoFrameCallback(loop);
    };
    M.relay = relay;
    relay.handle = v.requestVideoFrameCallback(loop);
    return track;
  }
  function stopFrameRelay() {
    const r = S.movie.relay;
    if (!r) return;
    S.movie.relay = null;
    try { el.localMovie.cancelVideoFrameCallback(r.handle); } catch {}
    try { r.track.stop(); } catch {}
  }

  function syncFileTracks(force) {
    const M = S.movie;
    if (!M.active || M.mode !== 'file' || !M.captured) return;
    const cap = M.captured.getVideoTracks().find((t) => t.readyState === 'live') || null;
    const wantRelay = cap && PRESETS[S.preset].fps > 30 && document.visibilityState === 'visible';
    const vt = (wantRelay && startFrameRelay()) || cap;
    if (force === true || vt !== M.videoOut) setMovieVideo(vt);
    if (!wantRelay && M.relay) stopFrameRelay();
    if (vt !== cap) nudgeFrame();
  }

  async function startScreen() {
    const pr = PRESETS[S.preset];
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: pr.fps, max: 60 } },
        // restrictOwnAudio: drop this page's own sound (your partner's voice) from captured system audio.
        // suppressLocalAudioPlayback: a shared tab stops playing itself; we play it echo-safe instead.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true, suppressLocalAudioPlayback: true },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'include',
      });
    } catch (err) {
      if (err && err.name !== 'NotAllowedError') toast(`Screen sharing failed: ${esc(err.message || err.name)}`, { warn: true });
      return;
    }
    if (S.movie.active) stopMovie();
    ensureMovieAudio();
    const M = S.movie;
    M.screenStream = stream;
    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0] || null;
    vt.onended = () => { if (M.screenStream === stream) stopMovie(); };
    try { await vt.applyConstraints({ width: { max: 1920 }, height: { max: pr.h }, frameRate: { max: pr.fps } }); } catch {}
    const surface = (vt.getSettings && vt.getSettings().displaySurface) || '';
    let aset = at && at.getSettings ? at.getSettings() : {};
    if (at && surface !== 'browser' && aset.restrictOwnAudio !== true) {
      try { await at.applyConstraints({ restrictOwnAudio: true }); aset = at.getSettings(); } catch {}
    }
    M.active = true;
    M.mode = 'screen';
    M.title = '';
    clearSubs(true);
    // A shared tab that no longer plays itself is played back by us, echo-safe.
    connectMovieAudio(at, !!at && surface === 'browser' && aset.suppressLocalAudioPlayback === true);
    await setMovieVideo(vt);
    sendApp({ type: 'movie', active: true, mode: 'screen', title: '' });
    sendApp({ type: 'quality', preset: S.preset });
    updateStage();
    if (!at) {
      toast('No sound is being shared. Stop, share again, and tick <b>Share system audio</b> (whole screen) or <b>Share tab audio</b> (a Chrome tab).', { warn: true, ms: 10000 });
    } else if (surface !== 'browser' && aset.restrictOwnAudio !== true) {
      toast("This browser can't keep your partner's voice out of whole-screen sound, so they'll hear themselves echo. Use <b>Movie</b>, share a Chrome tab, or update Chrome.", { warn: true, ms: 14000 });
    } else if (surface !== 'browser') {
      toast('Whole-screen sound: if your speakers are on, your mic hears the movie and your partner gets it twice. Wear earphones, or use <b>Movie</b> or a shared Chrome tab, which are echo-safe.', { warn: true, ms: 14000 });
    } else {
      toast('Sharing the tab with sound.');
    }
  }

  function stopMovie() {
    const M = S.movie;
    if (!M.active) return;
    clearInterval(M.audioCheck);
    if (M.mode === 'screen' && M.screenStream) M.screenStream.getTracks().forEach((t) => t.stop());
    M.screenStream = null;
    if (M.mode === 'file') {
      el.localMovie.pause();
      el.localMovie.removeAttribute('src');
      el.localMovie.load();
      if (M.objectUrl) URL.revokeObjectURL(M.objectUrl);
      M.objectUrl = null;
    }
    connectMovieAudio(null);
    const P0 = S.P;
    if (P0?.movieV) { P0.movieV.sender.replaceTrack(null).catch(() => {}); }
    stopFrameRelay();
    M.videoOut = null;
    M.active = false;
    M.mode = null;
    const P = S.P;
    if (P?.movieV) { P.movieV.sender.replaceTrack(null).catch(() => {}); P.movieA.sender.replaceTrack(null).catch(() => {}); }
    clearSubs(true);
    clearTimeout(S.countdownTimer);
    S.countdownTimer = null;
    showCountdown(0);
    sendApp({ type: 'movie', active: false });
    updateStage();
  }

  // ------------------------------------------------------------------ shared playback (file mode)
  function sendPlayback() {
    const v = el.localMovie;
    if (!(S.movie.active && S.movie.mode === 'file')) return;
    sendApp({ type: 'playback', paused: v.paused, t: v.currentTime || 0, d: Number.isFinite(v.duration) ? v.duration : 0, rate: v.playbackRate });
  }

  const VERB = { play: 'pressed play', pause: 'paused', toggle: null, seek: 'jumped', skip: null, countdown: 'started the countdown' };
  function applyControl(m, fromPartner) {
    if (!(S.movie.active && S.movie.mode === 'file')) return;
    if (fromPartner && !el.allowControl.checked) {
      sendApp({ type: 'notice', text: `${S.name} has locked the playback controls.` });
      return;
    }
    const v = el.localMovie;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    let verb = VERB[m.action];
    switch (m.action) {
      case 'toggle': if (v.paused) { v.play(); verb = 'pressed play'; } else { v.pause(); verb = 'paused'; } break;
      case 'play': v.play(); break;
      case 'pause': v.pause(); break;
      case 'seek': v.currentTime = clamp(Number(m.t) || 0, 0, dur); verb = `jumped to ${fmtTime(v.currentTime)}`; break;
      case 'skip': { const d = Number(m.delta) || 0; v.currentTime = clamp(v.currentTime + d, 0, dur); verb = d < 0 ? `went back ${-d} s` : `skipped ${d} s`; break; }
      case 'countdown': startCountdown(); break;
      default: return;
    }
    if (fromPartner && verb) toast(`<b>${pname()}</b> ${esc(verb)}.`, { ms: 2500 });
  }

  function control(action, extra = {}) {
    // Local user pressed a player button.
    if (S.movie.active && S.movie.mode === 'file') return applyControl({ action, ...extra }, false);
    if (S.partnerMovie?.active && S.partnerMovie.mode === 'file') {
      sendApp({ type: 'control', action, ...extra });
      const rp = S.remotePlayback;
      if (rp && (action === 'toggle' || action === 'play' || action === 'pause')) {
        rp.t = remoteTime(); rp.at = performance.now();
        rp.paused = action === 'toggle' ? !rp.paused : action === 'pause';
      }
    }
  }

  function remoteTime() {
    const rp = S.remotePlayback;
    if (!rp) return 0;
    const t = rp.paused ? rp.t : rp.t + ((performance.now() - rp.at) / 1000) * rp.rate;
    return rp.d ? Math.min(t, rp.d) : t;
  }

  function renderPlayerBar() {
    if (!watchingFile()) return;
    let paused, t, d;
    if (S.movie.active) {
      const v = el.localMovie;
      paused = v.paused; t = v.currentTime || 0; d = Number.isFinite(v.duration) ? v.duration : 0;
    } else {
      const rp = S.remotePlayback;
      if (!rp) return;
      paused = rp.paused; t = remoteTime(); d = rp.d;
    }
    if (el.pbToggle.dataset.icon !== (paused ? 'play' : 'pause')) setIcon(el.pbToggle, paused ? 'play' : 'pause');
    el.pbToggle.title = paused ? 'Play (space)' : 'Pause (space)';
    if (!S.seeking) {
      el.pbTime.textContent = fmtTime(t);
      el.pbSeek.value = d ? Math.round((t / d) * 1000) : 0;
    }
    el.pbDur.textContent = fmtTime(d);
  }

  function startCountdown() {
    if (S.countdownTimer || !(S.movie.active && S.movie.mode === 'file')) return;
    const v = el.localMovie;
    v.pause();
    let n = 3;
    const step = () => {
      showCountdown(n);
      sendApp({ type: 'countdown', n });
      if (n === 0) { S.countdownTimer = null; v.play(); return; }
      n--;
      S.countdownTimer = setTimeout(step, 1000);
    };
    step();
  }

  function showCountdown(n) {
    const c = el.countdown;
    if (!n) { c.classList.add('hidden'); c.textContent = ''; return; }
    c.textContent = String(n);
    c.classList.remove('hidden', 'tick');
    void c.offsetWidth;
    c.classList.add('tick');
  }

  // ------------------------------------------------------------------ subtitles
  function parseSubs(text) {
    text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const re = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
    const sec = (h, m, s, ms) => (Number(h) || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
    const cues = [];
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => re.test(l));
      if (i < 0) continue;
      const m = lines[i].match(re);
      const body = lines.slice(i + 1).join('\n').trim();
      if (!body) continue;
      cues.push({ start: sec(m[1], m[2], m[3], m[4]), end: sec(m[5], m[6], m[7], m[8]), text: body });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  function subHtml(text) {
    let s = String(text).replace(/\{\\[^}]*\}/g, '');
    s = esc(s).replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>').replace(/&lt;[^&]*?&gt;/g, '');
    return s.split('\n').filter((l) => l.trim()).map((l) => `<span>${l}</span>`).join('<br>');
  }

  function showSubtitle(text) {
    el.subtitle.innerHTML = text ? subHtml(text) : '';
  }

  async function loadSubs(file) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) { try { text = new TextDecoder('windows-1252').decode(buf); } catch {} }
    const cues = parseSubs(text);
    if (!cues.length) { toast("Couldn't find any subtitle lines in that file. Use an .srt or .vtt file.", { warn: true }); return; }
    S.subs = cues;
    S.subOffset = 0;
    el.subOffsetOut.textContent = '0.0 s';
    el.subName.textContent = `${file.name} (${cues.length} lines)`;
    el.subClearBtn.classList.remove('hidden');
    clearInterval(S.subTimer);
    S.subTimer = setInterval(tickSubs, 100);
    toast('Subtitles on for both of you.');
  }

  function tickSubs() {
    if (!S.subs || !(S.movie.active && S.movie.mode === 'file')) return;
    const t = el.localMovie.currentTime - S.subOffset;
    const text = S.subs.filter((c) => t >= c.start && t <= c.end).map((c) => c.text).join('\n');
    if (text !== S.lastSub) {
      S.lastSub = text;
      showSubtitle(text);
      sendApp({ type: 'sub', text });
    }
  }

  function clearSubs(keepUi) {
    clearInterval(S.subTimer);
    S.subTimer = null;
    S.subs = null;
    if (S.lastSub) sendApp({ type: 'sub', text: '' });
    S.lastSub = null;
    showSubtitle('');
    el.subClearBtn.classList.add('hidden');
    el.subName.textContent = 'Subtitles are sent as text and drawn sharp on both screens.';
    if (!keepUi) toast('Subtitles off.');
  }

  // ------------------------------------------------------------------ chat & reactions
  function addChat(text, mine, ts) {
    if (!text.trim()) return;
    const li = document.createElement('li');
    if (mine) li.className = 'me';
    li.textContent = text;
    const time = document.createElement('time');
    time.textContent = new Date(ts || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    li.appendChild(time);
    el.chatList.appendChild(li);
    el.chatList.scrollTop = el.chatList.scrollHeight;
    if (!mine) {
      if (el.chatPanel.classList.contains('hidden')) {
        S.unread++;
        el.chatBadge.classList.remove('hidden');
        toast(`<b>${pname()}</b> ${esc(text.length > 160 ? text.slice(0, 160) + '…' : text)}`, { ms: 5000 });
      }
      pipLine(`${S.partner.name}: ${text}`);
    }
  }
  function addChatSys(text) {
    const li = document.createElement('li');
    li.className = 'sys';
    li.textContent = text;
    el.chatList.appendChild(li);
  }
  function sendChat(text) {
    text = text.trim().slice(0, 1000);
    if (!text) return;
    if (!sendApp({ type: 'chat', text, ts: Date.now() })) { toast('Your partner isn’t connected yet.', { warn: true }); return false; }
    addChat(text, true);
    return true;
  }

  function react(emoji, x, y) {
    showReaction(emoji, S.name, x, y);
    sendApp({ type: 'react', emoji, x, y });
  }

  function showReaction(emoji, who, x, y) {
    if (S.pipWin) pipLine(`${who || ''} ${emoji}`);
    if (REDUCED_MOTION) { toast(`<b>${esc(who || '')}</b> ${esc(emoji)}`, { ms: 2000 }); return; }
    const layer = el.reactionLayer;
    if (layer.childElementCount > 40) return;
    const n = document.createElement('div');
    if (typeof x === 'number' && typeof y === 'number') {
      n.className = 'pop';
      n.style.left = `${clamp(x, 0, 1) * 100}%`;
      n.style.top = `${clamp(y, 0, 1) * 100}%`;
      n.textContent = emoji;
      setTimeout(() => n.remove(), 1200);
    } else {
      n.className = 'float';
      n.style.left = `${62 + Math.random() * 30}%`;
      n.style.setProperty('--sway', `${(Math.random() * 60 - 30).toFixed(0)}px`);
      n.innerHTML = `${esc(emoji)}<span class="who">${esc(who || '')}</span>`;
      setTimeout(() => n.remove(), 3400);
    }
    layer.appendChild(n);
  }

  // ------------------------------------------------------------------ pop-out (Document Picture-in-Picture)
  async function popOut() {
    if (S.pipWin) { S.pipWin.close(); return; }
    if (window.documentPictureInPicture) {
      let win;
      try { win = await documentPictureInPicture.requestWindow({ width: 340, height: 330 }); } catch (err) { toast(esc(err.message), { warn: true }); return; }
      S.pipWin = win;
      for (const ss of document.styleSheets) {
        try {
          const st = win.document.createElement('style');
          st.textContent = [...ss.cssRules].map((r) => r.cssText).join('\n');
          win.document.head.appendChild(st);
        } catch {
          if (ss.href) { const l = win.document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; win.document.head.appendChild(l); }
        }
      }
      win.document.title = 'TwoSeats';
      win.document.body.className = 'pip-body';
      win.document.body.innerHTML = `
        <div class="pip">
          <div class="pip-cam"></div>
          <ol class="pip-lines" aria-live="polite"></ol>
          <div class="pip-bar">
            <button class="ctl pip-mic" data-icon="mic" title="Mute"></button>
            <button class="pip-emo" data-emoji="❤️">❤️</button><button class="pip-emo" data-emoji="😂">😂</button>
            <button class="pip-emo" data-emoji="😮">😮</button><button class="pip-emo" data-emoji="😢">😢</button>
          </div>
          <form class="pip-chat"><input placeholder="Message" maxlength="1000" autocomplete="off"><button class="icon-btn" data-icon="send" title="Send"></button></form>
        </div>`;
      paintIcons(win.document);
      win.document.querySelector('.pip-cam').appendChild(el.partnerBubble);
      playEl(el.partnerCam);
      win.document.querySelector('.pip-mic').onclick = () => setMic(!S.micOn);
      win.document.querySelectorAll('.pip-emo').forEach((b) => (b.onclick = () => react(b.dataset.emoji)));
      const f = win.document.querySelector('.pip-chat');
      f.onsubmit = (e) => { e.preventDefault(); const i = f.querySelector('input'); if (sendChat(i.value)) { pipLine(`You: ${i.value.trim()}`); i.value = ''; } };
      win.addEventListener('pagehide', () => {
        el.bubbles.prepend(el.partnerBubble);
        playEl(el.partnerCam);
        S.pipWin = null;
      });
      refreshPip();
    } else if (document.pictureInPictureEnabled && el.partnerCam.requestPictureInPicture) {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await el.partnerCam.requestPictureInPicture();
      } catch { toast("Pop-out needs your partner's camera to be on.", { warn: true }); }
    } else {
      toast('Pop-out works in Chrome or Edge on a computer.', { warn: true });
    }
  }
  function refreshPip() {
    const w = S.pipWin;
    if (!w) return;
    const b = w.document.querySelector('.pip-mic');
    if (b) { setIcon(b, S.micOn ? 'mic' : 'micOff'); b.classList.toggle('off', !S.micOn); }
  }
  function pipLine(text) {
    const w = S.pipWin;
    if (!w) return;
    const ol = w.document.querySelector('.pip-lines');
    const li = w.document.createElement('li');
    li.textContent = text;
    ol.appendChild(li);
    while (ol.children.length > 4) ol.firstElementChild.remove();
  }

  // ------------------------------------------------------------------ stats
  async function pollStats() {
    const P = S.P;
    if (!P || P.pc.connectionState !== 'connected') return;
    let report;
    try { report = await P.pc.getStats(); } catch { return; }
    let pair = null;
    report.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = report.get(r.selectedCandidatePairId); });
    if (!pair) report.forEach((r) => { if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded')) && !pair) pair = r; });
    const lc = pair && report.get(pair.localCandidateId);
    const rc = pair && report.get(pair.remoteCandidateId);
    const relay = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
    const rtt = pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
    el.connRoute.classList.remove('hidden');
    el.connRoute.classList.toggle('relay', relay);
    el.connRoute.textContent = `${relay ? 'Relayed' : 'Direct'}${rtt != null ? ` ${rtt} ms` : ''}`;
    el.connRoute.title = relay ? 'Going through the TURN relay' : 'Peer-to-peer, nothing in between';

    const codecOf = (rep, r) => { const c = r && r.codecId && rep.get(r.codecId); return c ? c.mimeType.replace(/^video\//, '') : '?'; };
    const lines = [`route    ${relay ? 'TURN relay' : 'direct P2P'} (${lc?.candidateType || '?'} → ${rc?.candidateType || '?'})`, `rtt      ${rtt ?? '?'} ms`];
    if (pair?.availableOutgoingBitrate) lines.push(`uplink   ~${(pair.availableOutgoingBitrate / 1e6).toFixed(1)} Mbps estimate`);

    if (S.movie.active && P.movieV?.sender.track) {
      try {
        const rep = await P.movieV.sender.getStats();
        let o = null;
        rep.forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'video') o = r; });
        if (o) {
          const prev = S.stat.out;
          const kbps = prev && o.timestamp > prev.ts ? ((o.bytesSent - prev.bytes) * 8) / (o.timestamp - prev.ts) : 0;
          S.stat.out = { bytes: o.bytesSent, ts: o.timestamp };
          lines.push(`sending  ${o.frameWidth || '?'}x${o.frameHeight || '?'} @ ${Math.round(o.framesPerSecond || 0)} fps, ${(kbps / 1000).toFixed(1)} Mbps, ${codecOf(rep, o)}`);
          lines.push(`limit    ${o.qualityLimitationReason || 'none'}${o.encoderImplementation ? `, encoder ${o.encoderImplementation}` : ''}`);
        }
      } catch {}
    } else S.stat.out = null;

    if (P.rxMovieV && S.partnerMovie?.active) {
      try {
        const rep = await P.rxMovieV.receiver.getStats();
        let i = null;
        rep.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') i = r; });
        if (i) {
          const prev = S.stat.in;
          const kbps = prev && i.timestamp > prev.ts ? ((i.bytesReceived - prev.bytes) * 8) / (i.timestamp - prev.ts) : 0;
          S.stat.in = { bytes: i.bytesReceived, ts: i.timestamp };
          const jb = i.jitterBufferEmittedCount ? (i.jitterBufferDelay / i.jitterBufferEmittedCount) * 1000 : 80;
          S.subDelayMs = clamp(Math.round(jb + (rtt || 60) / 2 + 40), 80, 700);
          lines.push(`watching ${i.frameWidth || '?'}x${i.frameHeight || '?'} @ ${Math.round(i.framesPerSecond || 0)} fps, ${(kbps / 1000).toFixed(1)} Mbps, ${codecOf(rep, i)}`);
          lines.push(`health   lost ${i.packetsLost || 0} pkts, dropped ${i.framesDropped || 0} frames, buffer ${Math.round(jb)} ms`);
        }
      } catch {}
    } else S.stat.in = null;

    if (el.statsToggle.checked) el.stats.textContent = lines.join('\n');
  }

  // ------------------------------------------------------------------ chrome, panels, gestures
  const panelOpen = () => !el.chatPanel.classList.contains('hidden') || !el.settingsPanel.classList.contains('hidden') || !el.reactTray.classList.contains('hidden');
  function setIdle(on) {
    el.room.classList.toggle('idle', on);
    layoutSubtitle();
  }
  function poke() {
    setIdle(false);
    clearTimeout(S.idleTimer);
    if (isWatching() && !panelOpen()) S.idleTimer = setTimeout(() => setIdle(true), 3500);
  }

  // Keep subtitles inside the bottom of the picture (not the letterbox), and above the player bar.
  function layoutSubtitle() {
    const v = !el.localMovie.classList.contains('hidden') ? el.localMovie : el.remoteMovie;
    const sr = el.stage.getBoundingClientRect();
    if (!sr.height) return;
    let bottom = sr.height * 0.08;
    if (v.videoWidth && v.videoHeight) {
      const k = Math.min(sr.width / v.videoWidth, sr.height / v.videoHeight);
      const dh = v.videoHeight * k;
      bottom = (sr.height - dh) / 2 + dh * 0.06;
    }
    if (!el.room.classList.contains('idle') && !el.playerBar.classList.contains('hidden')) {
      const pb = el.playerBar.getBoundingClientRect();
      bottom = Math.max(bottom, sr.bottom - pb.top + 10);
    }
    el.subtitle.style.bottom = `${Math.round(bottom)}px`;
  }
  function togglePanel(panel, force) {
    const open = force ?? panel.classList.contains('hidden');
    [el.chatPanel, el.settingsPanel, el.reactTray].forEach((p) => { if (p !== panel) p.classList.add('hidden'); });
    panel.classList.toggle('hidden', !open);
    el.chatBtn.classList.toggle('on', !el.chatPanel.classList.contains('hidden'));
    el.settingsBtn.classList.toggle('on', !el.settingsPanel.classList.contains('hidden'));
    el.reactBtn.classList.toggle('on', !el.reactTray.classList.contains('hidden'));
    if (panel === el.chatPanel && open) {
      S.unread = 0;
      el.chatBadge.classList.add('hidden');
      el.chatList.scrollTop = el.chatList.scrollHeight;
      if (!IS_MOBILE) el.chatInput.focus();
    }
    poke();
  }

  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const r = el.room;
    if (r.requestFullscreen) r.requestFullscreen().catch(nativeVideoFs);
    else if (r.webkitRequestFullscreen) r.webkitRequestFullscreen();
    else nativeVideoFs();
  }
  function nativeVideoFs() {
    const v = !el.remoteMovie.classList.contains('hidden') ? el.remoteMovie : null;
    if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    else toast('Turn your phone sideways for the full picture. Adding TwoSeats to your Home Screen hides Safari’s bars too.', { ms: 6000 });
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !S.wakeLock) {
        S.wakeLock = await navigator.wakeLock.request('screen');
        S.wakeLock.addEventListener('release', () => (S.wakeLock = null));
      }
    } catch {}
  }

  async function invite() {
    const url = inviteUrl();
    if (IS_MOBILE && navigator.share) {
      try { await navigator.share({ title: 'TwoSeats', text: 'Movie night? Your seat is saved:', url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(`Invite link copied: <b>${esc(url)}</b>`);
    } catch {
      toast(`Send this link: <b>${esc(url)}</b>`, { ms: 10000 });
    }
  }

  function leave() {
    S.left = true;
    sendApp({ type: 'bye' });
    wsSend({ type: 'leave' });
    setTimeout(() => {
      try { S.ws && S.ws.close(); } catch {}
      closePeer(true);
      if (S.movie.active) stopMovie();
      [S.micTrack, S.camTrack].forEach((t) => t && t.stop());
      location.href = '/';
    }, 150);
  }

  function bindRoom() {
    el.micBtn.onclick = () => setMic(!S.micOn);
    el.camBtn.onclick = () => setCam(!S.camOn);
    el.fileBtn.onclick = el.emptyFile.onclick = () => el.fileInput.click();
    el.fileInput.onchange = () => { const f = el.fileInput.files[0]; el.fileInput.value = ''; startFile(f); };
    el.screenBtn.onclick = el.emptyScreen.onclick = () => startScreen();
    el.stopShareBtn.onclick = el.stopShare2.onclick = () => stopMovie();
    el.reactBtn.onclick = () => togglePanel(el.reactTray);
    el.reactTray.onclick = (e) => { const b = e.target.closest('[data-emoji]'); if (b) react(b.dataset.emoji); };
    el.chatBtn.onclick = () => togglePanel(el.chatPanel);
    el.settingsBtn.onclick = () => togglePanel(el.settingsPanel);
    $$('[data-close]').forEach((b) => (b.onclick = () => togglePanel(document.getElementById(b.dataset.close), false)));
    el.chatForm.onsubmit = (e) => { e.preventDefault(); if (sendChat(el.chatInput.value)) el.chatInput.value = ''; };
    el.fsBtn.onclick = toggleFullscreen;
    el.leaveBtn.onclick = leave;
    el.inviteBtn.onclick = el.emptyInvite.onclick = invite;
    el.popoutBtn.onclick = el.popoutBtn2.onclick = popOut;
    el.tapToPlay.onclick = () => {
      el.tapToPlay.classList.add('hidden');
      [el.partnerAudio, el.remoteMovie, el.partnerCam].forEach((m) => m.srcObject && m.play().catch(() => {}));
    };
    el.remoteMovie.addEventListener('webkitendfullscreen', () => playEl(el.remoteMovie));
    document.addEventListener('fullscreenchange', refreshControls);
    window.addEventListener('resize', layoutSubtitle);
    [el.localMovie, el.remoteMovie].forEach((m) => { m.addEventListener('resize', layoutSubtitle); m.addEventListener('loadedmetadata', layoutSubtitle); });
    document.addEventListener('webkitfullscreenchange', refreshControls);

    // player bar
    el.pbToggle.onclick = () => control('toggle');
    el.pbBack.onclick = () => control('skip', { delta: -10 });
    el.pbFwd.onclick = () => control('skip', { delta: 10 });
    el.pbCountdown.onclick = () => control('countdown');
    const dur = () => (S.movie.active ? el.localMovie.duration : S.remotePlayback?.d) || 0;
    el.pbSeek.oninput = () => { S.seeking = true; el.pbTime.textContent = fmtTime((el.pbSeek.value / 1000) * dur()); };
    el.pbSeek.onchange = () => { control('seek', { t: (el.pbSeek.value / 1000) * dur() }); setTimeout(() => (S.seeking = false), 600); };

    // host video element -> partner
    const v = el.localMovie;
    ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'ended'].forEach((ev) => v.addEventListener(ev, sendPlayback));
    v.addEventListener('playing', () => { if (S.movie.ctx && S.movie.ctx.state !== 'running') S.movie.ctx.resume().catch(() => {}); syncFileTracks(); tuneMovieVideo(); });
    v.addEventListener('loadedmetadata', tuneMovieVideo);
    setInterval(() => { if (S.movie.active && S.movie.mode === 'file' && !v.paused) sendPlayback(); }, 1000);

    // settings
    el.qualitySel.onchange = () => {
      S.preset = el.qualitySel.value;
      store.set('preset', S.preset);
      if (S.movie.active) { syncFileTracks(); tuneMovieVideo(); if (S.movie.mode === 'screen') S.movie.screenStream?.getVideoTracks()[0]?.applyConstraints({ width: { max: 1920 }, height: { max: PRESETS[S.preset].h }, frameRate: { max: PRESETS[S.preset].fps } }).catch(() => {}); }
      sendApp({ type: 'quality', preset: S.preset, from: S.movie.active ? 'host' : 'viewer' });
    };
    el.codecSel.onchange = () => {
      S.codec = el.codecSel.value;
      store.set('codec', S.codec);
      const P = S.P;
      if (P?.movieV) { applyCodecPrefs(P.movieV); makeOffer(P); toast('Codec change sent. The picture may pause for a second.'); }
    };
    el.movieVol.oninput = () => {
      S.movieGain = el.movieVol.value / 100;
      el.movieVolOut.textContent = `${el.movieVol.value}%`;
      applyGain();
      sendApp({ type: 'gain', v: S.movieGain });
    };
    el.voiceVol.oninput = () => { el.partnerAudio.volume = el.voiceVol.value / 100; el.voiceVolOut.textContent = `${el.voiceVol.value}%`; };
    el.localVol.oninput = () => {
      const M = S.movie;
      if (M.localGain) M.localGain.gain.setTargetAtTime(el.localVol.value / 100, M.ctx.currentTime, 0.05);
      el.localVolOut.textContent = `${el.localVol.value}%`;
    };
    el.echoSafe.checked = store.get('echoSafe') !== '0';
    el.echoSafe.onchange = () => { store.set('echoSafe', el.echoSafe.checked ? '1' : '0'); routeLocalOut(); };
    el.subLoadBtn.onclick = () => {
      if (!(S.movie.active && S.movie.mode === 'file')) { toast('Start a movie file first, then add its subtitles.'); return; }
      el.subInput.click();
    };
    el.subInput.onchange = () => { const f = el.subInput.files[0]; el.subInput.value = ''; loadSubs(f); };
    el.subClearBtn.onclick = () => clearSubs(false);
    const shift = (d) => { S.subOffset = Math.round((S.subOffset + d) * 10) / 10; el.subOffsetOut.textContent = `${S.subOffset > 0 ? '+' : ''}${S.subOffset.toFixed(1)} s`; };
    el.subEarlier.onclick = () => shift(-0.5);
    el.subLater.onclick = () => shift(0.5);
    el.subSize.oninput = () => { document.documentElement.style.setProperty('--sub-scale', el.subSize.value / 100); store.set('subSize', el.subSize.value); };
    el.statsToggle.onchange = () => el.stats.classList.toggle('hidden', !el.statsToggle.checked);

    // stage gestures: double-tap = heart, tap = show/hide controls (touch) or play/pause (mouse)
    let lastTap = 0;
    let tapTimer = null;
    el.stage.addEventListener('pointerup', (e) => {
      if (e.target.closest('.bubble, button, input, .panel, #playerBar, .tray')) return;
      if (!el.reactTray.classList.contains('hidden')) { togglePanel(el.reactTray, false); return; }
      const now = Date.now();
      if (now - lastTap < 320) {
        clearTimeout(tapTimer);
        lastTap = 0;
        const r = el.stage.getBoundingClientRect();
        react('❤️', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        return;
      }
      lastTap = now;
      const touch = e.pointerType !== 'mouse';
      tapTimer = setTimeout(() => {
        if (touch) {
          if (el.room.classList.contains('idle')) poke();
          else if (isWatching()) { clearTimeout(S.idleTimer); setIdle(true); }
        } else if (watchingFile()) control('toggle');
      }, 320);
    });
    ['pointermove', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, (e) => { if (e.pointerType !== 'touch') poke(); }, { passive: true }));

    // draggable camera bubbles; tap a bubble to resize it
    let drag = null;
    el.bubbles.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.bubble');
      if (!b || el.room.classList.contains('call-mode')) return;
      const r = el.bubbles.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, bubble: b };
      el.bubbles.setPointerCapture(e.pointerId);
    });
    el.bubbles.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      const sr = el.stage.getBoundingClientRect();
      const br = el.bubbles.getBoundingClientRect();
      el.bubbles.style.left = `${clamp(drag.left + dx, 4, sr.width - br.width - 4)}px`;
      el.bubbles.style.top = `${clamp(drag.top + dy, 4, sr.height - br.height - 4)}px`;
      el.bubbles.style.right = 'auto';
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        const b = drag.bubble;
        const next = b.classList.contains('size-s') ? '' : b.classList.contains('size-l') ? 'size-s' : 'size-l';
        b.classList.remove('size-s', 'size-l');
        if (next) b.classList.add(next);
      }
      drag = null;
    };
    el.bubbles.addEventListener('pointerup', endDrag);
    el.bubbles.addEventListener('pointercancel', endDrag);

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (!S.inRoom || e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ' && watchingFile()) { e.preventDefault(); control('toggle'); }
      else if (k === 'arrowleft' && watchingFile()) control('skip', { delta: -10 });
      else if (k === 'arrowright' && watchingFile()) control('skip', { delta: 10 });
      else if (k === 'm') setMic(!S.micOn);
      else if (k === 'v') setCam(!S.camOn);
      else if (k === 'c') { e.preventDefault(); togglePanel(el.chatPanel); }
      else if (k === 'f') toggleFullscreen();
      else if (k === 'escape') [el.chatPanel, el.settingsPanel, el.reactTray].forEach((p) => p.classList.add('hidden'));
    });

    document.addEventListener('visibilitychange', () => {
      syncFileTracks();
      if (document.visibilityState === 'visible' && S.inRoom) { keepAwake(); playEl(el.remoteMovie); playEl(el.partnerAudio); }
    });
    window.addEventListener('pagehide', () => { if (S.inRoom) sendApp({ type: 'bye' }); });
  }

  // ------------------------------------------------------------------ boot
  initLobby();
  bindRoom();
  // exposed for debugging in the console
  window.twoseats = { S, PRESETS, Echo };
})();

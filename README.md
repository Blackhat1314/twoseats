# TwoSeats

Private movie night for two. Your PC streams a movie straight to your partner's phone, peer-to-peer, at up to 1080p and 60 fps, with voice, cameras, chat and reactions on top.

```
 PC (Chrome / Edge)  ── movie + voice + camera ──►  iPhone (Safari)
        ▲              direct WebRTC, P2P               │
        └──────────────── voice + camera ───────────────┘
                 (Render only introduces the two of you)
```

## Features

- **Movie file mode**: pick a file on your PC and it plays in the app. It streams at the source frame rate (60 fps sources stay 60 fps) with clean stereo sound, no screen capture involved.
- **Screen mode**: share a screen, window or tab with system sound. Use it for VLC, MKV files with AC3/DTS sound, streaming sites, anything.
- **Shared controls**: either of you can play, pause, skip ±10 s or seek. There's also a **3, 2, 1, play** countdown. The host can lock controls.
- **Subtitles**: load an `.srt` / `.vtt` file. The text goes over the data channel and is drawn sharp on both screens, with a timing nudge of ±0.5 s.
- Mute, camera on/off, draggable camera bubbles (tap to resize), and a speaking glow.
- Chat, floating emoji reactions, and **double-tap the movie to send a heart** where you tapped.
- **Movie volume** sets what the watcher hears, so the soundtrack can be balanced against your voices from either side.
- Quality presets from 1080p60 (10 Mbps, or 16 Mbps "extra sharp") down to 480p data saver, plus codec choice (H.264 default, best on iPhone).
- **Pop out** (Chrome/Edge): an always-on-top mini window with her camera, chat, mute and reactions while you watch in VLC.
- Live stats: resolution, fps, bitrate, codec, round-trip time, and whether you're **Direct** or **Relayed**.
- iPhone polish: Add to Home Screen (full-screen app), screen stays awake, and native full screen.
- Resilient: after you connect, renegotiation runs over the peer connection itself. The call keeps going even if the server restarts or sleeps (this was tested).

## Deploy on Render (free, about 5 minutes)

Vercel won't work: its serverless functions can't keep the WebSocket open that call setup needs. Render can.

1. Push this folder to a GitHub repo.
2. Render Dashboard → **New → Blueprint** → choose the repo → **Apply**. `render.yaml` sets everything up.
   (Manual alternative: **New → Web Service**, Node runtime, build `npm install`, start `node server.js`.)
3. Open `https://<your-service>.onrender.com` on your PC, take your seat, press **Invite**, and send her the link.

The free plan sleeps after 15 minutes idle, so the first open can take 30–60 s. During a call the app pings every 25 s, which keeps it awake.

Also runs anywhere with Docker: `docker build -t twoseats . && docker run -p 3000:3000 twoseats` (it needs HTTPS in front of it for the camera and mic).

## Add a TURN relay (recommended)

Most home Wi-Fi connects directly. Some mobile data networks (CGNAT on Jio/Airtel 4G/5G, for example) block direct connections. If the app says it can't make a direct connection, add a relay:

1. Cloudflare dashboard → **Realtime → TURN** → create a TURN app → copy the **Token ID** and **API token**.
2. Render → your service → **Environment** → set `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN` → save (it redeploys).

Cloudflare's free tier is 1,000 GB/month. A relayed 2-hour movie at 10 Mbps is about 9 GB, and the relay is only used when a direct path fails. Other providers (Metered, coturn) work via `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL`.

To test the relay on purpose, add `?relay=1` to the URL on both devices. The top bar should then read **Relayed**.

## Movie night checklist

| | You (PC) | Her (iPhone) |
|---|---|---|
| Browser | Chrome or Edge | Safari (or the Home Screen app) |
| Sound | Speakers are fine in Movie mode or tab sharing (echo-safe). **Wear earphones** when sharing the whole screen | Earphones or AirPods for the best sound |
| Stream | **Movie** button for MP4/WebM; **Screen** for everything else | Turn the phone sideways |

- **Screen mode sound**: in Chrome's share picker, tick **Share system audio** (Entire screen) or **Share tab audio** (a tab). Mac Chrome can't capture system sound, so use Movie mode or share a tab.
- **File formats**: MP4 (H.264/HEVC + AAC) and WebM play directly. MKV often has AC3/DTS sound the browser can't decode; the app tells you, and Screen mode with VLC covers it.
- **Frame rate**: most films are 24 fps and stream at 24. 60 fps matters for 60 fps sources such as sports, games and some YouTube.
- **Ramp-up**: WebRTC probes your bandwidth, so the picture can take 10–30 s to reach full sharpness.
- **Upload speed**: 1080p60 needs about 10 Mbps of upload on your side. If her picture stutters, either of you can pick a lower preset in Settings.
- **Keep the TwoSeats tab visible** in Movie mode. A hidden tab falls back to 30 fps.

### She hears the sound twice or an echo
- **Movie mode** is echo-safe by default. Your playback goes through a loopback connection, so Chrome's echo canceller strips it from your mic (Settings → *Echo-safe sound on this PC*).
- **Sharing a Chrome tab** is echo-safe too: the tab goes quiet and TwoSeats plays it for you.
- **Sharing the whole screen with system sound** (VLC and similar): TwoSeats asks Chrome to leave your partner's voice out of the captured sound (`restrictOwnAudio`, Chrome on Windows/Mac). VLC's sound from your speakers still reaches your mic, so **wear earphones** in this mode, or use Movie or a shared tab instead.

Keyboard (PC): `Space` play/pause, `←`/`→` ±10 s, `M` mute, `V` camera, `C` chat, `F` full screen.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

`localhost` counts as secure, so you can test with two browser tabs. The iPhone needs HTTPS, so use the Render URL for real use.

## How it works

- `server.js`: a static file server, `/api/ice` (STUN plus optional TURN credentials) and `/ws`, a 2-person signaling room. Only connection setup goes through it; no media touches the server.
- `public/app.js`: WebRTC with the "perfect negotiation" pattern. Face audio/video use one pair of transceivers, the movie uses a send-only pair, and a data channel carries chat, reactions, playback, subtitles and renegotiation.
  - Chrome caps `<video>.captureStream()` at 30 fps, so Movie mode forwards each decoded frame through `requestVideoFrameCallback` → `MediaStreamTrackGenerator`.
  - Movie audio passes through a Web Audio gain node, which is what drives the remote **Movie volume**.
  - Opus is negotiated as 256 kbps stereo so the soundtrack isn't squashed like a phone call.
- Rooms hold exactly two people. Anyone with the room link can join an empty seat, so share links only with each other. `/api/ice` hands out TURN credentials to anyone who calls it. That's fine for a personal app, but keep the URL to yourselves.

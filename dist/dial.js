(async function() {
        while (!Spicetify.React || !Spicetify.ReactDOM) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        var dial = (() => {
  var LOG = "[Dial]";
  var STORAGE_KEY = "dial:settings";
  var SPEED_KEY = "item.speed";
  var PITCH_KEY = "audio.pitch_factor";
  var MIN_RATE = 0.5;
  var MAX_RATE = 1.5;
  var QUEUE_DEPTH = 80;
  var NEAR_START_MS = 2e3;
  var END_WINDOW_MS = 8e3;
  var PRESETS = [
    { name: "Slowed", rate: 0.85 },
    { name: "Normal", rate: 1 },
    { name: "Sped up", rate: 1.25 }
  ];
  var TIMELINES = [
    {
      id: "real",
      name: "Real time",
      tip: "Counts real seconds. The length stretches to actual listening time."
    },
    {
      id: "song",
      name: "Song time",
      tip: "Your true position in the song. Seconds tick slower than real ones."
    }
  ];
  var SPRING = {
    rate: { response: 0.3, damping: 0.78 },
    pill: { response: 0.42, damping: 0.9 },
    over: { response: 0.5, damping: 0.55 },
    press: { response: 0.34, damping: 0.45 },
    grab: { response: 0.25, damping: 1 },
    digit: { response: 0.5, damping: 0.72 },
    disclosure: { response: 0.5, damping: 1 },
    needle: { response: 0.26, damping: 0.38 }
  };
  var NEEDLE_SWEEP = 140;
  var MAX_OVERFLOW = 7;
  var PLACES = [1, ".", 0.1, 0.01];
  var MIDDOT = "\xB7";
  var DETENT = 0.025;
  var MAGNET = 0.05;
  var TOOLTIP_RADIUS = 10;
  var TOOLTIP_CARET = 7;
  var NOTE_TRAVEL = 16;
  var NOTE_MIN_FRAME_MS = 140;
  var clamp = (v) => Math.min(MAX_RATE, Math.max(MIN_RATE, v));
  var decay = (v, max = MAX_OVERFLOW) => 2 * (1 / (1 + Math.exp(-v / max)) - 0.5) * max;

  var api = () => Spicetify.Platform?.PlayerAPI;
  function currentSpeed() {
    const st = api()?.getState?.();
    const raw = st?.item?.metadata?.[SPEED_KEY];
    if (raw != null) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0)
        return n;
    }
    const native = Number(st?.speed);
    return Number.isFinite(native) && native > 0 ? native : 1;
  }
  function currentPitchLinked() {
    return api()?.getState?.()?.item?.metadata?.[PITCH_KEY] != null;
  }

  var DBG = window.DialDebug ?? (window.DialDebug = {});

  var state = {
    rate: 1,
    timeline: "real",
    pitch: true,
    presets: [PRESETS[0]?.rate ?? 0.85, 1, PRESETS[2]?.rate ?? 1.25],
    presetNames: PRESETS.map((p) => p.name)
  };
  var loadPresets = (saved) => {
    if (!Array.isArray(saved) || saved.length !== 3)
      return;
    const nums = saved.map((v) => typeof v === "number" && Number.isFinite(v) ? clamp(v) : null);
    if (nums.some((v) => v === null))
      return;
    state.presets = nums;
  };
  var loadNames = (saved) => {
    if (!Array.isArray(saved) || saved.length !== 3)
      return;
    const names = saved.map(
      (v) => typeof v === "string" && v.trim() ? v.trim().slice(0, 12) : null
    );
    if (names.some((v) => v === null))
      return;
    state.presetNames = names;
  };
  function load() {
    try {
      const saved = JSON.parse(Spicetify.LocalStorage.get(STORAGE_KEY) ?? "{}");
      if (typeof saved.rate === "number")
        state.rate = clamp(saved.rate);
      if (TIMELINES.some((t) => t.id === saved.timeline)) {
        state.timeline = saved.timeline;
      }
      if (typeof saved.pitch === "boolean")
        state.pitch = saved.pitch;
      loadPresets(saved.presets);
      loadNames(saved.presetNames);
    } catch (e) {
      console.warn(LOG, "could not read saved settings", e);
    }
  }
  var saveTimer = null;
  function save() {
    if (DBG.noSave)
      return;
    if (saveTimer)
      clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.warn(LOG, "could not save settings", e);
      }
    }, 350);
  }
  var listeners = new Set();
  function onChange(fn) {
    listeners.add(fn);
  }
  function emitChange() {
    for (const fn of listeners)
      fn();
  }

  var isPodcast = (item) => item.type === "episode" || !!item.uri?.startsWith("spotify:episode:");
  function mediaKind(item) {
    if (!item?.uri)
      return "track";
    if (isPodcast(item))
      return "podcast";
    if (item.uri.startsWith("spotify:local:"))
      return "local";
    return "track";
  }
  var currentKind = "track";
  var getKind = () => currentKind;
  function setKind(kind) {
    if (kind === currentKind)
      return;
    currentKind = kind;
    emitChange();
  }
  var support = { speed: null, pitch: null };
  var PROBE_DELAYS_MS = [600, 2400, 3e3];
  var probeRun = 0;
  async function probeSupport() {
    if (state.rate === 1)
      return;
    const run = ++probeRun;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const delay of PROBE_DELAYS_MS) {
      await sleep(delay);
      if (run !== probeRun)
        return;
      const md = api()?.getState?.()?.item?.metadata ?? {};
      const sawSpeed = md[SPEED_KEY] != null;
      const sawPitch2 = state.pitch ? md[PITCH_KEY] != null : support.pitch;
      if (sawSpeed) {
        if (sawSpeed === support.speed && sawPitch2 === support.pitch)
          return;
        support.speed = sawSpeed;
        support.pitch = sawPitch2;
        console.log(LOG, `native key support: speed=${sawSpeed} pitch=${sawPitch2}`);
        emitChange();
        return;
      }
    }
    const sawPitch = state.pitch ? false : support.pitch;
    if (support.speed === false && sawPitch === support.pitch)
      return;
    support.speed = false;
    support.pitch = sawPitch;
    console.log(LOG, "native key support: speed keys absent after all samples");
    emitChange();
  }

  var real = null;
  var isOwnContext = (uri) => !!uri && uri.startsWith("spotify:track:");
  var getRealContext = () => real;
  var rememberContext = (ctx) => {
    real = ctx;
  };
  var played = [];
  var PLAYED_MAX = 12;
  function notePlayed(uri) {
    if (!uri || !uri.startsWith("spotify:track:"))
      return;
    if (played[played.length - 1] === uri)
      return;
    played.push(uri);
    if (played.length > PLAYED_MAX)
      played.shift();
  }
  function playedBefore(currentUri) {
    return played.filter((u) => u !== currentUri).slice(-PLAYED_MAX);
  }
  var ROWS_MAX = 5;
  var rowsCache = new Map();
  var likedRows = null;
  async function likedBefore(trackUri) {
    try {
      for (let page = 0; page < 4; page++) {
        const from = likedRows?.length ?? 0;
        const res = await Spicetify.Platform.LibraryAPI?.getTracks?.({ limit: 50, offset: from });
        const rows = (res?.items ?? []).map((i) => i?.uri).filter((u) => !!u);
        if (!rows.length)
          break;
        likedRows = [...likedRows ?? [], ...rows];
        const at = likedRows.indexOf(trackUri);
        if (at >= 0)
          return likedRows.slice(Math.max(0, at - ROWS_MAX), at);
        if (rows.length < 50)
          break;
      }
      return null;
    } catch {
      return null;
    }
  }
  async function rowsBefore(contextUri, trackUri) {
    if (!contextUri)
      return null;
    if (contextUri === "spotify:collection:liked-songs")
      return likedBefore(trackUri);
    if (!contextUri.startsWith("spotify:playlist:"))
      return null;
    try {
      let rows = rowsCache.get(contextUri);
      if (!rows) {
        const res = await Spicetify.Platform.PlaylistAPI?.getPlaylist?.(contextUri);
        rows = (res?.rows ?? []).map((r) => r?.uri).filter((u) => typeof u === "string" && u.startsWith("spotify:track:"));
        if (rows.length)
          rowsCache.set(contextUri, rows);
      }
      const at = rows?.indexOf(trackUri) ?? -1;
      if (at < 1)
        return null;
      return rows.slice(Math.max(0, at - ROWS_MAX), at);
    } catch {
      return null;
    }
  }

  var SHUFFLE_OFF = 0;
  var SHUFFLE_ON = 1;
  var SHUFFLE_SMART = 2;
  var mode = SHUFFLE_OFF;
  var patched = false;
  var modeOf = (st) => st?.shuffle ? st.smartShuffle ? SHUFFLE_SMART : SHUFFLE_ON : SHUFFLE_OFF;
  var shuffleWanted = () => mode !== SHUFFLE_OFF;
  function patchShuffle() {
    mode = modeOf(api()?.getState?.());
    const S = Spicetify.Platform?.ShuffleAPI;
    if (!S || typeof S.setShuffle !== "function" || S.__dialPatched)
      return;
    const original = S.setShuffle.bind(S);
    S.setShuffle = (uri, next, opts) => {
      mode = next;
      return original(uri, next, opts);
    };
    S.__dialPatched = true;
    patched = true;
  }
  function observeShuffle(st) {
    if (patched)
      return;
    if (st?.shuffle)
      mode = modeOf(st);
  }
  async function restoreShuffle(contextUri) {
    try {
      await Spicetify.Platform?.ContextualShuffleAPI?.setContextualShuffleMode(contextUri, mode);
    } catch {
      console.log(LOG, `could not restore shuffle mode ${mode}`);
    }
  }

  var applying = false;
  var applyTimer = null;
  var carriedTail = null;
  async function applySpeed() {
    if (DBG.noApply)
      return;
    const P = api();
    const st = P?.getState?.();
    const item = st?.item;
    if (!P || !st || !item?.uri || applying)
      return;
    applying = true;
    try {
      const kind = mediaKind(item);
      setKind(kind);
      if (kind !== "track")
        return;
      const ctx = st.context;
      if (ctx?.uri && !isOwnContext(ctx.uri)) {
        rememberContext({ uri: ctx.uri, metadata: ctx.metadata });
      }
      const carries = item.metadata?.[SPEED_KEY] != null || item.metadata?.[PITCH_KEY] != null;
      if (state.rate === 1 && !carries && !getRealContext())
        return;
      observeShuffle(st);
      const position = Math.round(Spicetify.Player.getProgress());
      const metadata = state.rate === 1 ? {} : {
        [SPEED_KEY]: String(state.rate),
        ...state.pitch ? { [PITCH_KEY]: String(state.rate) } : {}
      };
      const upcoming = (st.nextItems ?? []).slice(0, DBG.queueDepth ?? QUEUE_DEPTH).filter((n) => n?.uri);
      const nextUris = upcoming.map((n) => n.uri);
      const contextRows = shuffleWanted() ? null : await rowsBefore(st.context?.uri, item.uri);
      const history = (contextRows ?? playedBefore(item.uri)).filter((uri) => !nextUris.includes(uri)).map((uri) => ({ uri, metadata }));
      const withSpeed = (it) => ({ uri: it.uri, uid: it.uid, metadata });
      const items = [...history, withSpeed(item), ...upcoming.map(withSpeed)];
      carriedTail = items[items.length - 1]?.uri ?? null;
      const real2 = getRealContext();
      if (state.rate === 1 && real2) {
        await restoreShuffle(real2.uri);
        await P.play(
          { uri: real2.uri },
          {},
          {
            skipTo: { uri: item.uri },
            seekTo: position > NEAR_START_MS ? position : void 0,
            shuffle: shuffleWanted(),
            repeat: st.repeat,
            paused: st.isPaused
          }
        );
        rememberContext(null);
        carriedTail = null;
        console.log(LOG, "restored playback to its original context");
        return;
      }
      await P.play(
        { uri: item.uri, pages: [{ items }] },
        {},
        {
          skipTo: { uri: item.uri },
          seekTo: position > NEAR_START_MS ? position : void 0,
          shuffle: state.rate === 1 ? shuffleWanted() : false,
          repeat: st.repeat,
          paused: st.isPaused
        }
      );
      console.log(LOG, `applied ${state.rate}x to "${item.name}" (+${items.length - 1} queued)`);
      void probeSupport();
    } catch (e) {
      console.error(LOG, "could not apply speed", e);
      Spicetify.showNotification?.("Dial: could not change speed", true);
    } finally {
      applying = false;
      emitChange();
    }
  }
  function atRelayBoundary(uri) {
    return !!uri && !!carriedTail && uri === carriedTail && !!getRealContext();
  }
  async function relayToRealContext() {
    const P = api();
    const st = P?.getState?.();
    const real2 = getRealContext();
    const item = st?.item;
    if (!P || !st || !item?.uri || !real2)
      return;
    try {
      await restoreShuffle(real2.uri);
      await P.play(
        { uri: real2.uri },
        {},
        {
          skipTo: { uri: item.uri },
          shuffle: shuffleWanted(),
          repeat: st.repeat,
          paused: st.isPaused
        }
      );
      carriedTail = null;
      rememberContext(null);
      console.log(LOG, "relayed playback back to its original context at the page boundary");
    } catch (e) {
      console.warn(LOG, "relay failed; staying inside the carried page", e);
    }
  }
  function applySpeedSoon(delay = 430) {
    if (applyTimer)
      clearTimeout(applyTimer);
    applyTimer = setTimeout(() => void applySpeed(), delay);
  }
  function setRate(v) {
    state.rate = clamp(Math.round(v * 100) / 100);
    if (state.rate === 1 && (support.speed === false || support.pitch === false)) {
      support.speed = null;
      support.pitch = null;
    }
    save();
    emitChange();
  }
  function setPitch(on) {
    state.pitch = on;
    save();
    emitChange();
    applySpeedSoon(0);
  }
  async function setTimeline(id) {
    if (!TIMELINES.some((t) => t.id === id))
      return;
    state.timeline = id;
    save();
    emitChange();
  }

  var BUBBLE_SEL = '[data-testid="progress-label"]';
  var TIME_LABEL_SEL = '[data-testid="playback-position"], [data-testid="playback-duration"]';
  var fmtMs = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1e3));
    const s = String(total % 60).padStart(2, "0");
    const m = Math.floor(total / 60);
    if (m >= 60)
      return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`;
    return `${m}:${s}`;
  };
  function textNodeOf(el) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walk.nextNode()) {
      if (node.nodeValue && node.nodeValue.trim())
        return node;
    }
    return null;
  }
  var parseTime = (text) => {
    const m = /^(-)?(\d+):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
    if (!m)
      return null;
    const secs = m[4] ? Number(m[3]) * 60 + Number(m[4]) : Number(m[3]);
    const total = Number(m[2]) * (m[4] ? 3600 : 60) + secs;
    return total * 1e3 * (m[1] ? -1 : 1);
  };
  var enabled = () => currentSpeed() !== 1 && getKind() === "track";
  var otherMs = (displayMs) => {
    const scale = currentSpeed();
    return state.timeline === "real" ? displayMs * scale : displayMs / scale;
  };
  var rolls = new Map();
  function syncBubble(node) {
    const el = node.nodeType === 1 ? node.closest(BUBBLE_SEL) : node.parentElement?.closest(BUBBLE_SEL) ?? null;
    if (!el)
      return;
    const clear = (attr) => {
      if (el.hasAttribute(attr))
        el.removeAttribute(attr);
    };
    if (!enabled()) {
      clear("data-dial-other");
      clear("data-dial-main");
      return;
    }
    const ms = parseTime(el.textContent ?? "");
    if (ms == null) {
      clear("data-dial-other");
      clear("data-dial-main");
      return;
    }
    const real2 = state.timeline === "real";
    const set = (attr, v) => {
      if (el.getAttribute(attr) !== v)
        el.setAttribute(attr, v);
    };
    if (real2)
      set("data-dial-main", fmtMs(ms / currentSpeed()));
    else
      clear("data-dial-main");
    set("data-dial-other", real2 ? fmtMs(ms) : fmtMs(ms / currentSpeed()));
  }
  var rollLineA = (el) => {
    const roll = rolls.get(el);
    if (!roll)
      return null;
    const walker = document.createTreeWalker(roll.strip, NodeFilter.SHOW_TEXT);
    return walker.nextNode();
  };
  var rollFrozen = (el) => rolls.get(el)?.frozen === true;
  function noteLabelWrite(el, target, ms) {
    const roll = rolls.get(el);
    if (!roll || roll.frozen)
      return;
    const lineA = rollLineA(el);
    if (lineA && lineA.nodeValue !== target)
      lineA.nodeValue = target;
    const remaining = target.trimStart().startsWith("-");
    roll.lineB.textContent = (remaining ? "-" : "") + fmtMs(Math.abs(otherMs(ms)));
  }
  function buildRoll(el, otherText) {
    const span = el.querySelector("span");
    const textNode = span ? textNodeOf(span) : null;
    if (!span || !textNode?.nodeValue)
      return null;
    const h = span.getBoundingClientRect().height;
    if (!h)
      return null;
    const makeLine = (text) => {
      const line = document.createElement("span");
      line.style.cssText = "display:block;";
      line.style.height = `${h}px`;
      line.textContent = text;
      return line;
    };
    const lineB = makeLine(otherText);
    const strip = document.createElement("span");
    strip.style.cssText = "display:block;will-change:transform;transform:translateY(-50%);";
    strip.append(lineB, makeLine(textNode.nodeValue));
    const win = document.createElement("span");
    win.style.cssText = "display:inline-block;overflow:hidden;vertical-align:top;";
    win.style.height = `${h}px`;
    win.append(strip);
    span.replaceChildren(win);
    return { span, textNode, strip, lineB, anim: null };
  }
  function startRoll(el) {
    if (rolls.has(el) || !enabled())
      return;
    const text = (el.textContent ?? "").trim();
    const ms = parseTime(text);
    if (ms == null)
      return;
    const remaining = text.startsWith("-");
    const roll = buildRoll(el, (remaining ? "-" : "") + fmtMs(Math.abs(otherMs(Math.abs(ms)))));
    if (!roll)
      return;
    rolls.set(el, roll);
    roll.anim?.cancel();
    roll.anim = roll.strip.animate(
      [{ transform: "translateY(-50%)" }, { transform: "translateY(0%)" }],
      { duration: 340, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "both" }
    );
  }
  function rollTo(el, target) {
    const current = (el.textContent ?? "").trim();
    if (current === target || !el.isConnected)
      return false;
    if (rolls.has(el))
      endRoll(el, false);
    const roll = buildRoll(el, target);
    if (!roll)
      return false;
    roll.frozen = true;
    rolls.set(el, roll);
    roll.anim?.cancel();
    roll.anim = roll.strip.animate(
      [{ transform: "translateY(-50%)" }, { transform: "translateY(0%)" }],
      { duration: 340, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "both" }
    );
    roll.anim.onfinish = () => {
      rolls.delete(el);
      if (!roll.span.isConnected)
        return;
      roll.textNode.nodeValue = target;
      roll.span.replaceChildren(roll.textNode);
      onRestore?.();
    };
    return true;
  }
  function endRoll(el, animateOut = true) {
    const roll = rolls.get(el);
    if (!roll)
      return;
    rolls.delete(el);
    const restore = () => {
      if (!roll.span.isConnected)
        return;
      roll.span.replaceChildren(roll.textNode);
      onRestore?.();
    };
    if (!animateOut) {
      roll.anim?.cancel();
      restore();
      return;
    }
    roll.anim?.cancel();
    roll.anim = roll.strip.animate(
      [{ transform: "translateY(0%)" }, { transform: "translateY(-50%)" }],
      { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "both" }
    );
    roll.anim.onfinish = restore;
    roll.anim.oncancel = restore;
  }
  var onOver = (e) => {
    const el = e.target.closest?.(TIME_LABEL_SEL);
    if (!el || rolls.has(el) || el.contains(e.relatedTarget))
      return;
    startRoll(el);
  };
  var onOut = (e) => {
    const el = e.target.closest?.(TIME_LABEL_SEL);
    if (!el || !rolls.has(el) || el.contains(e.relatedTarget))
      return;
    endRoll(el);
  };
  function resetPlaybarTimes() {
    for (const el of [...rolls.keys()])
      endRoll(el, false);
    for (const el of document.querySelectorAll(BUBBLE_SEL))
      syncBubble(el);
  }
  var onRestore = null;
  var bound = false;
  function initPlaybarTimes(restoreHook) {
    if (bound)
      return;
    bound = true;
    onRestore = restoreHook;
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
  }

  var lastSeen = { uri: null, pos: 0, dur: 0 };
  var ranToEnd = false;
  var previousRanToEnd = () => ranToEnd;
  var clearRanToEnd = () => {
    ranToEnd = false;
  };
  function fix(s) {
    if (!s || typeof s !== "object")
      return s;
    const uri = s.item?.uri ?? null;
    if (uri) {
      if (uri !== lastSeen.uri) {
        ranToEnd = lastSeen.dur > 0 && lastSeen.pos >= lastSeen.dur - END_WINDOW_MS;
        lastSeen = { uri, pos: 0, dur: Number(s.duration) || 0 };
        const kind = mediaKind(s.item);
        queueMicrotask(() => setKind(kind));
      } else {
        lastSeen.pos = Number(s.positionAsOfTimestamp) || lastSeen.pos;
        lastSeen.dur = Number(s.duration) || lastSeen.dur;
      }
    }
    const real2 = getRealContext();
    const ctx = s.context;
    if (real2 && ctx && s.item?.metadata?.[SPEED_KEY] != null) {
      try {
        ctx.uri = real2.uri;
        if (real2.metadata)
          ctx.metadata = real2.metadata;
      } catch {
      }
    }
    const raw = s.item?.metadata?.[SPEED_KEY];
    const n = raw == null ? null : parseFloat(raw);
    if (n == null || !Number.isFinite(n) || n <= 0)
      return s;
    try {
      s.speed = n;
    } catch {
    }
    return s;
  }
  function patchEventSpeed() {
    const emitter = api()?._events?._emitter;
    if (!emitter || emitter.__dialPatched)
      return;
    const fixArg = (a) => {
      if (!a || typeof a !== "object")
        return a;
      const rec = a;
      const data = rec.data;
      try {
        if (data && typeof data === "object" && "positionAsOfTimestamp" in data)
          fix(data);
        else if ("positionAsOfTimestamp" in rec)
          fix(rec);
      } catch (e) {
        console.warn(LOG, "could not fix a player event", e);
      }
      return a;
    };
    const names = ["emit", "emitSync", "emitEvent", "emitEventSync", "emitAndWait", "emitEventAndWait"];
    for (const name of names) {
      const original = emitter[name];
      if (typeof original !== "function")
        continue;
      emitter[name] = function(...args) {
        args.forEach(fixArg);
        return original.apply(this, args);
      };
    }
    emitter.__dialPatched = true;
    console.log(LOG, "patched player event stream");
  }
  function patchStateSpeed() {
    const P = api();
    if (!P || P.__dialPatched)
      return;
    try {
      let current = fix(P._state);
      Object.defineProperty(P, "_state", {
        configurable: true,
        get: () => current,
        set: (v) => {
          try {
            current = fix(v);
          } catch {
            current = v;
          }
        }
      });
      P.__dialPatched = true;
      console.log(LOG, "patched player state");
    } catch (e) {
      console.warn(LOG, "could not patch state", e);
    }
  }
  function patchGetProgress() {
    if (Spicetify.Player.__dialProgressPatched)
      return;
    const original = Spicetify.Player.getProgress.bind(Spicetify.Player);
    Spicetify.Player.getProgress = () => {
      const st = api()?._state;
      if (!st)
        return original();
      const base = Number(st.positionAsOfTimestamp) || 0;
      if (st.isPaused || st.isBuffering || !st.hasContext)
        return Math.round(base);
      const rate = currentSpeed();
      const duration = Number(st.duration) || Infinity;
      return Math.round(Math.min(base + (Date.now() - Number(st.timestamp)) * rate, duration));
    };
    Spicetify.Player.__dialProgressPatched = true;
    console.log(LOG, "patched Player.getProgress");
  }
  var POS_SEL = '[data-testid="playback-position"]';
  var DUR_SEL = '[data-testid="playback-duration"]';
  function patchTimelineLabels() {
    const LABEL_SEL = `${POS_SEL}, ${DUR_SEL}`;
    const ANY_SEL = `${LABEL_SEL}, ${BUBBLE_SEL}`;
    let timer = null;
    const active2 = () => state.timeline === "real" && currentSpeed() !== 1 && getKind() === "track";
    const textNodeOf2 = (el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      return walk.nextNode();
    };
    const write = (el, target, ms) => {
      if (rollFrozen(el))
        return;
      if ((el.textContent ?? "") !== target) {
        const node = rollLineA(el) ?? textNodeOf2(el);
        if (node)
          node.nodeValue = target;
      }
      noteLabelWrite(el, target, ms);
    };
    const targets = () => {
      const scale = active2() ? currentSpeed() : 1;
      const st = api()?.getState?.();
      const dur = Number(st?.duration) || 0;
      if (!st)
        return [];
      const pos = Spicetify.Player.getProgress();
      const list = [];
      const posEl = document.querySelector(POS_SEL);
      if (posEl) {
        const text = posEl.textContent ?? "";
        const remaining = text.trimStart().startsWith("-");
        const ms = remaining ? dur > 0 ? dur - pos : 0 : pos;
        list.push({ el: posEl, text: (remaining ? "-" : "") + fmtMs(ms / scale), ms: ms / scale });
      }
      const durEl = document.querySelector(DUR_SEL);
      if (durEl && dur > 0)
        list.push({ el: durEl, text: fmtMs(dur / scale), ms: dur / scale });
      return list;
    };
    const update = () => {
      for (const t of targets())
        write(t.el, t.text, t.ms);
      arm();
    };
    const arm = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const st = api()?.getState?.();
      const rate = currentSpeed();
      if (!st || st.isPaused || st.isBuffering || rate === 1 || getKind() !== "track")
        return;
      const speed = state.timeline === "real" ? 1 : rate;
      const shown = state.timeline === "real" ? Spicetify.Player.getProgress() / rate : Spicetify.Player.getProgress();
      const wait = (1e3 - shown % 1e3) / speed + 8;
      timer = setTimeout(update, Math.max(20, wait));
    };
    const hit = () => update();
    const observer = new MutationObserver((muts) => {
      let labelHit = false;
      for (const m of muts) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.matches?.(BUBBLE_SEL))
              syncBubble(n);
          }
        }
        const t = m.target;
        const el = t.nodeType === 1 ? t.closest(ANY_SEL) : t.parentElement?.closest(ANY_SEL) ?? null;
        if (!el)
          continue;
        if (el.matches(BUBBLE_SEL)) {
          syncBubble(el);
          continue;
        }
        if (active2() || currentSpeed() !== 1)
          labelHit = true;
      }
      if (labelHit)
        hit();
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    let lastTimeline = state.timeline;
    initPlaybarTimes(update);
    onChange(() => {
      try {
        resetPlaybarTimes();
        if (state.timeline !== lastTimeline) {
          lastTimeline = state.timeline;
          for (const t of targets()) {
            if (!rollTo(t.el, t.text))
              write(t.el, t.text, t.ms);
          }
          return;
        }
        update();
      } catch (e) {
        console.warn(LOG, "label update fell back", e);
        update();
      }
    });
    update();
    console.log(LOG, "patched timeline labels");
  }

  function compositedStyle(el) {
    let anim = null;
    let last2 = "";
    return (key, props) => {
      if (key === last2)
        return;
      last2 = key;
      anim?.cancel();
      const kf = props ?? { transform: key };
      anim = el.animate([kf, kf], { duration: 1, fill: "both" });
    };
  }

  var active = new Set();
  var dirty = new Set();
  var frame = null;
  var last = 0;
  function tick(now) {
    const dt = Math.min((now - last) / 1e3, 1 / 30);
    last = now;
    for (const s of [...active])
      s.step(dt);
    for (const paint of dirty)
      paint();
    dirty.clear();
    frame = active.size ? requestAnimationFrame(tick) : null;
  }
  var engine = {
    wake(s) {
      active.add(s);
      if (frame === null) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    sleep(s) {
      active.delete(s);
    },
    mark(paint) {
      if (frame === null)
        paint();
      else
        dirty.add(paint);
    }
  };

  var mq = matchMedia("(prefers-reduced-motion: reduce)");
  function reduced() {
    return mq.matches || !!DBG.forceReduced;
  }

  var REST = 4e-4;
  function createSpring({
    value = 0,
    response,
    damping,
    onUpdate,
    onRest
  }) {
    let pos = value;
    let vel = 0;
    let target = value;
    const stepper = {
      step(dt) {
        const w = 2 * Math.PI / response;
        vel += (-(w * w) * (pos - target) - 2 * damping * w * vel) * dt;
        pos += vel * dt;
        let rested = false;
        if (Math.abs(pos - target) < REST && Math.abs(vel) < REST) {
          pos = target;
          vel = 0;
          engine.sleep(stepper);
          rested = true;
        }
        onUpdate(pos, vel);
        if (rested)
          onRest?.();
      }
    };
    return {
      get value() {
        return pos;
      },
      set(to, animate = true, initialVelocity) {
        target = to;
        if (!animate || reduced()) {
          engine.sleep(stepper);
          pos = to;
          vel = 0;
          onUpdate(pos, vel);
          return;
        }
        if (initialVelocity != null)
          vel = initialVelocity;
        engine.wake(stepper);
      }
    };
  }

  function createCounter(host) {
    const digits = [];
    let cellHeight = 0;
    let column = null;
    host.innerHTML = "";
    for (const place of PLACES) {
      if (place === ".") {
        const dot = document.createElement("span");
        dot.className = "dial-dot";
        dot.textContent = ".";
        host.appendChild(dot);
        continue;
      }
      const col = document.createElement("span");
      col.className = "dial-digit";
      const strip = document.createElement("span");
      strip.className = "dial-strip";
      for (let n = 0; n <= 10; n++) {
        const cell = document.createElement("span");
        cell.className = "dial-num";
        cell.textContent = String(n % 10);
        strip.appendChild(cell);
      }
      col.appendChild(strip);
      host.appendChild(col);
      column ?? (column = col);
      const setStrip = compositedStyle(strip);
      const digit = {
        place,
        setStrip,
        spring: createSpring({
          value: Math.floor(1 / place),
          ...SPRING.digit,
          onUpdate: (v) => paint(setStrip, v)
        })
      };
      digits.push(digit);
    }
    function paint(setStrip, latest) {
      if (!cellHeight || DBG.noDigitWrite)
        return;
      const v = (latest % 10 + 10) % 10;
      setStrip(`translateY(${(-v * cellHeight).toFixed(2)}px)`);
    }
    return {
      measure() {
        if (column?.offsetHeight)
          cellHeight = column.offsetHeight;
        for (const d of digits)
          paint(d.setStrip, d.spring.value);
      },
      set(rate, animate = true) {
        if (DBG.noDigits)
          return;
        for (const d of digits)
          d.spring.set(Math.floor(rate / d.place + 1e-9), animate);
      }
    };
  }
  var signKey = "";
  var measureCtx = null;
  function alignSign(pop, counter, sign) {
    const key = `${getComputedStyle(counter).fontSize}/${getComputedStyle(sign).fontSize}`;
    if (key === signKey)
      return;
    signKey = key;
    const probe = document.createElement("div");
    probe.className = "dial-readout";
    probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;--sign-shift:0px";
    probe.innerHTML = '<span class="dial-counter"><span class="dial-digit"><span class="dial-strip"><span class="dial-num"><span>0<i></i></span></span></span></span></span><span class="dial-x">&times;<i></i></span>';
    probe.querySelectorAll("i").forEach((i) => {
      i.style.cssText = "display:inline-block;width:0;height:0";
    });
    pop.appendChild(probe);
    const struts = probe.querySelectorAll("i");
    const digitBaseline = struts[0].getBoundingClientRect().bottom;
    const signBaseline = struts[1].getBoundingClientRect().bottom;
    const probeSign = probe.querySelector(".dial-x");
    const cs = getComputedStyle(probeSign);
    const font = {
      size: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      family: cs.fontFamily,
      char: probeSign.firstChild?.nodeValue ?? "\xD7"
    };
    probe.remove();
    let inkDescent = -font.size * 0.11;
    measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d"));
    if (measureCtx) {
      measureCtx.font = `${font.weight} ${font.size}px ${font.family}`;
      if (measureCtx.font.includes(`${font.size}px`)) {
        const m = measureCtx.measureText(font.char);
        if (Number.isFinite(m.actualBoundingBoxDescent))
          inkDescent = m.actualBoundingBoxDescent;
      }
    }
    pop.style.setProperty("--sign-shift", `${(digitBaseline - (signBaseline + inkDescent)).toFixed(2)}px`);
  }

  var GAUGE_ICON = '<svg class="dial-gauge" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="2 -0.5 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" overflow="visible" style="overflow:visible"><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>';
  var GAUGE = {
    originX: 2,
    originY: -0.5,
    view: 20,
    pivotX: 12,
    pivotY: 14,
    head: 3.5 * Math.SQRT2,
    tail: 0.7 * Math.SQRT2,
    stroke: 2,
    rest: 45
  };
  var CHEVRON_ICON = '<svg class="dial-chev" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var WARN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

  var panelMarkup = () => `
  <div class="dial-head">
    <span class="dial-title">Playback speed</span>
    <button class="dial-reset" type="button">Reset</button>
  </div>
  <div class="dial-readout">
    <span class="dial-counter"></span><span class="dial-x">&times;</span>
    <span class="dial-note"><span class="dial-note-text"></span></span>
  </div>
  <div class="dial-slider-wrap" tabindex="0" role="slider"
       aria-label="Playback speed" aria-valuemin="${MIN_RATE}" aria-valuemax="${MAX_RATE}">
    <div class="dial-groove"><div class="dial-fill"></div></div>
    <div class="dial-thumb"></div>
  </div>
  <div class="dial-presets-host"></div>
  <div class="dial-notice" role="status"></div>
  <button class="dial-adv-toggle" type="button" aria-expanded="false">
    <span>Advanced options</span>
    ${CHEVRON_ICON}
  </button>
  <div class="dial-adv">
    <div class="dial-adv-inner">
      <div class="dial-sub">Pitch</div>
      <div class="dial-pitch-host"></div>
      <div class="dial-sub">Timeline</div>
      <div class="dial-timeline-host"></div>
      <div class="dial-sub">Presets</div>
      <div class="dial-preset-row">
        <input class="dial-name" data-i="0" maxlength="12" spellcheck="false" aria-label="Slowed preset name">
        <div class="dial-stepper">
          <button class="dial-step" type="button" data-i="0" data-d="-1" aria-label="Slowed preset down">&minus;</button>
          <input class="dial-val" data-i="0" maxlength="5" inputmode="decimal" spellcheck="false" aria-label="Slowed preset rate">
          <button class="dial-step" type="button" data-i="0" data-d="1" aria-label="Slowed preset up">+</button>
        </div>
      </div>
      <div class="dial-preset-row">
        <input class="dial-name" data-i="1" maxlength="12" spellcheck="false" aria-label="Normal preset name">
        <div class="dial-stepper">
          <button class="dial-step" type="button" data-i="1" data-d="-1" aria-label="Normal preset down">&minus;</button>
          <input class="dial-val" data-i="1" maxlength="5" inputmode="decimal" spellcheck="false" aria-label="Normal preset rate">
          <button class="dial-step" type="button" data-i="1" data-d="1" aria-label="Normal preset up">+</button>
        </div>
      </div>
      <div class="dial-preset-row">
        <input class="dial-name" data-i="2" maxlength="12" spellcheck="false" aria-label="Sped up preset name">
        <div class="dial-stepper">
          <button class="dial-step" type="button" data-i="2" data-d="-1" aria-label="Sped up preset down">&minus;</button>
          <input class="dial-val" data-i="2" maxlength="5" inputmode="decimal" spellcheck="false" aria-label="Sped up preset rate">
          <button class="dial-step" type="button" data-i="2" data-d="1" aria-label="Sped up preset up">+</button>
        </div>
      </div>
    </div>
  </div>
  <div class="dial-tooltip">
    <svg class="dial-tip-edge" aria-hidden="true" preserveAspectRatio="none">
      <linearGradient id="dial-tip-edge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".42"/>
        <stop offset=".5" stop-color="#fff" stop-opacity=".12"/>
        <stop offset="1" stop-color="#fff" stop-opacity=".22"/>
      </linearGradient>
      <path fill="none" stroke="url(#dial-tip-edge)" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    <div class="dial-tip-body"></div>
  </div>`;

  var SIM_STEP_MS = 8;
  var MAX_SAMPLES = 200;
  var DEFAULT_KEYFRAMES = 12;
  var SETTLE_MS = 100;
  function createNeedle(getButton) {
    let node = null;
    let anim = null;
    let scale = 0;
    const spring = { ...SPRING.needle };
    let path = [1];
    let target = 1;
    let trailing = null;
    let pending = null;
    let attachTries = 0;
    const ATTACH_TRIES = 200;
    const ATTACH_RETRY_MS = 150;
    const angleOf = (rate) => -45 + ((rate - MIN_RATE) / (MAX_RATE - MIN_RATE) - 0.5) * NEEDLE_SWEEP;
    const barAngleOf = (rate) => angleOf(rate) + GAUGE.rest;
    function simulate(from, velocity, to) {
      const dt = SIM_STEP_MS / 1e3;
      const w = 2 * Math.PI / spring.response;
      let pos = from;
      let vel = velocity;
      const out = [pos];
      for (let i = 0; i < MAX_SAMPLES; i++) {
        vel += (-(w * w) * (pos - to) - 2 * spring.damping * w * vel) * dt;
        pos += vel * dt;
        out.push(pos);
        if (Math.abs(pos - to) < 4e-4 && Math.abs(vel) < 4e-4)
          break;
      }
      out.push(to);
      return out;
    }
    function currentState() {
      if (!anim || path.length < 2)
        return { rate: path[0] ?? 1, vel: 0 };
      const elapsed = Number(anim.currentTime ?? 0);
      const i = Math.min(path.length - 1, Math.max(0, Math.round(elapsed / SIM_STEP_MS)));
      const rate = path[i];
      const prev = path[Math.max(0, i - 1)];
      return { rate, vel: (rate - prev) / (SIM_STEP_MS / 1e3) };
    }
    function attach() {
      if (node?.isConnected)
        return true;
      const button = getButton();
      const svg = button?.querySelector("svg.dial-gauge");
      if (!button || !svg) {
        node = null;
        return false;
      }
      const rect = svg.getBoundingClientRect();
      if (!rect.width) {
        node?.remove();
        node = null;
        return false;
      }
      scale = rect.width / GAUGE.view;
      const brect = button.getBoundingClientRect();
      const w = GAUGE.stroke * scale;
      const h = (GAUGE.head + GAUGE.tail) * scale;
      const bar = document.createElement("div");
      bar.className = "dial-needle";
      bar.style.cssText = `position:absolute;left:${(rect.left - brect.left + (GAUGE.pivotX - GAUGE.originX) * scale - w / 2).toFixed(3)}px;top:${(rect.top - brect.top + (GAUGE.pivotY - GAUGE.originY) * scale - GAUGE.head * scale).toFixed(3)}px;width:${w.toFixed(3)}px;height:${h.toFixed(3)}px;border-radius:${(w / 2).toFixed(3)}px;transform-origin:50% ${(h - GAUGE.tail * scale).toFixed(3)}px;`;
      button.appendChild(bar);
      node = bar;
      anim = null;
      return true;
    }
    function issue(springMotion) {
      if (DBG.noNeedle)
        return;
      if (!attach()) {
        if (attachTries++ < ATTACH_TRIES)
          setTimeout(() => issue(springMotion), ATTACH_RETRY_MS);
        return;
      }
      attachTries = 0;
      const bar = node;
      if (!bar)
        return;
      const { rate, vel } = currentState();
      path = simulate(rate, vel, target);
      if (!springMotion) {
        const held = { transform: `rotate(${barAngleOf(target).toFixed(2)}deg)` };
        path = [target];
        if (anim && anim.effect) {
          anim.effect.setKeyframes([held, held]);
          anim.effect.updateTiming({ duration: 1 });
          anim.currentTime = 0;
          anim.play();
        } else {
          anim = bar.animate([held, held], { duration: 1, fill: "both" });
        }
        return;
      }
      const want = Math.max(2, DBG.needleKeyframes ?? DEFAULT_KEYFRAMES);
      const stride = Math.max(1, Math.ceil((path.length - 1) / (want - 1)));
      const picked = [];
      for (let i = 0; i < path.length - 1; i += stride)
        picked.push(path[i]);
      picked.push(path[path.length - 1]);
      const frames = picked.map((r) => ({ transform: `rotate(${barAngleOf(r).toFixed(2)}deg)` }));
      const duration = Math.max(1, (path.length - 1) * SIM_STEP_MS);
      if (anim && anim.effect) {
        anim.effect.setKeyframes(frames);
        anim.effect.updateTiming({ duration });
        anim.currentTime = 0;
        anim.play();
        return;
      }
      anim = bar.animate(frames, { duration, easing: "linear", fill: "both" });
    }
    return {
      set(rate, animate = true) {
        if (rate === target && node?.isConnected)
          return;
        target = rate;
        attachTries = 0;
        pending = pending === false ? false : animate && DBG.needleSpring !== false && !reduced();
        if (!trailing)
          trailing = setTimeout(fire, SETTLE_MS);
      },
      dial(rate) {
        if (DBG.noNeedle)
          return;
        target = rate;
        attachTries = 0;
        if (trailing) {
          clearTimeout(trailing);
          trailing = null;
        }
        pending = null;
        issue(false);
      },
      refresh() {
        if (node && !node.isConnected)
          node = null;
      }
    };
    function fire() {
      trailing = null;
      if (pending === null)
        return;
      const springMotion = pending;
      pending = null;
      issue(springMotion);
    }
  }

  function describeRate(rate, pitchFollows) {
    if (Math.abs(rate - 1) < 5e-3)
      return "Normal speed";
    const pct = Math.round(Math.abs(rate - 1) * 100);
    const semis = 12 * Math.log2(rate);
    const shift = pitchFollows ? ` ${MIDDOT} ${semis > 0 ? "+" : "\u2212"}${Math.abs(semis).toFixed(1)} st` : "";
    return `${pct}% ${rate < 1 ? "slower" : "faster"}${shift}`;
  }
  function createNote(wrap, text) {
    text.textContent = "Normal speed";
    const setWrap = compositedStyle(wrap);
    let last2 = "";
    let lastAt = 0;
    let timer = null;
    const spring = createSpring({
      value: 0,
      ...SPRING.over,
      onUpdate: (v) => engine.mark(() => {
        const tx = `translateX(${((1 - v) * NOTE_TRAVEL).toFixed(2)}px)`;
        const opacity = Math.max(0, Math.min(1, v)).toFixed(3);
        setWrap(`${tx}|${opacity}`, { transform: tx, opacity });
      })
    });
    return {
      reveal(shown) {
        spring.set(shown ? 1 : 0);
      },
      set(rate, pitchFollows) {
        const next = describeRate(rate, pitchFollows);
        if (next === last2 || DBG.noNote)
          return;
        const write = () => {
          lastAt = performance.now();
          if (text.firstChild)
            text.firstChild.nodeValue = next;
          last2 = next;
        };
        if (timer)
          clearTimeout(timer);
        if (performance.now() - lastAt >= NOTE_MIN_FRAME_MS)
          write();
        else
          timer = setTimeout(write, NOTE_MIN_FRAME_MS + 10);
      }
    };
  }

  function createSegmented({
    host,
    items,
    compact = false,
    allowNone = false,
    onPick,
    onHover,
    onLeave
  }) {
    const el = document.createElement("div");
    el.className = "dial-seg" + (compact ? " is-compact" : "");
    el.style.gridTemplateColumns = `repeat(${items.length},1fr)`;
    const pill = document.createElement("div");
    pill.className = "dial-seg-pill";
    pill.style.width = `calc((100% - 8px) / ${items.length})`;
    el.appendChild(pill);
    for (const item of items) {
      const button = document.createElement("button");
      button.className = "dial-seg-btn";
      button.type = "button";
      button.textContent = item.label;
      if (item.tip)
        button.dataset.tip = item.tip;
      if (item.warn)
        button.dataset.warn = item.warn;
      button.addEventListener("click", () => {
        onLeave();
        if (current === items.indexOf(item)) {
          if (!pressPending) {
            squashSpring.set(0, true, -4);
            pulseLabel();
          }
          pressPending = false;
          return;
        }
        onPick(item.value);
      });
      const labelSpan = () => invRow.children[items.indexOf(item)];
      const pulseLabel = () => {
        const wasHeld = button.classList.contains("is-held");
        button.classList.remove("is-held");
        labelSpan()?.classList.remove("is-held");
        const frames = [
          { transform: wasHeld ? "scale(0.94)" : "scale(0.97)" },
          { transform: "scale(1.06)", offset: 0.55, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
          { transform: "scale(1)" }
        ];
        const opts = { duration: 240, easing: "ease-out" };
        button.animate(frames, opts);
        labelSpan()?.animate(frames, opts);
      };
      button.addEventListener("pointerdown", () => {
        if (current !== items.indexOf(item))
          return;
        held = true;
        pressPending = true;
        button.classList.add("is-held");
        labelSpan()?.classList.add("is-held");
        squashSpring.set(HELD_SQUASH, true);
      });
      const releaseHold = () => {
        if (!held)
          return;
        held = false;
        squashSpring.set(0, true, 1.5);
        pulseLabel();
      };
      button.addEventListener("pointerup", releaseHold);
      button.addEventListener("pointercancel", releaseHold);
      button.addEventListener("pointerleave", releaseHold);
      button.addEventListener("mouseenter", () => onHover(button));
      button.addEventListener("mouseleave", onLeave);
      button.addEventListener("focus", () => {
        if (button.matches(":focus-visible"))
          onHover(button);
      });
      button.addEventListener("blur", onLeave);
      el.appendChild(button);
    }
    const inv = document.createElement("div");
    inv.className = "dial-seg-inv";
    inv.setAttribute("aria-hidden", "true");
    inv.style.width = `calc((100% - 8px) / ${items.length})`;
    const invRow = document.createElement("div");
    invRow.className = "dial-seg-inv-row";
    invRow.style.width = `${items.length * 100}%`;
    invRow.style.gridTemplateColumns = `repeat(${items.length},1fr)`;
    for (const item of items) {
      const span = document.createElement("span");
      span.textContent = item.label;
      invRow.appendChild(span);
    }
    inv.appendChild(invRow);
    el.appendChild(inv);
    host.replaceWith(el);
    const setPill = compositedStyle(pill);
    const setInv = compositedStyle(inv);
    const setInvRow = compositedStyle(invRow);
    let width = 0;
    let on = !allowNone;
    let current = null;
    let pillPos = 0;
    let pillVel = 0;
    let squash = 0;
    let held = false;
    let pressPending = false;
    const HELD_SQUASH = -0.12;
    function draw(pos, vel) {
      if (!width)
        return;
      const step = (width - 8) / items.length;
      const stretch = Math.min(Math.abs(vel) * 0.05, 0.14);
      const sx = (1 + stretch) * (1 - squash * 0.5);
      const sy = (1 - stretch * 0.35) * (1 + squash);
      const shift = (pos * step).toFixed(2);
      const opacity = on ? "1" : "0";
      const transform = `translateX(${shift}px) scaleX(${sx.toFixed(3)}) scaleY(${sy.toFixed(3)})`;
      const invT = `translateX(${shift}px)`;
      setPill(transform, { transform });
      setInv(invT, { transform: invT });
      setInvRow(`translateX(${(-pos * step).toFixed(2)}px)`);
      if (pill.style.opacity !== opacity)
        pill.style.opacity = opacity;
      if (inv.style.opacity !== opacity)
        inv.style.opacity = opacity;
    }
    const spring = createSpring({
      value: 0,
      ...SPRING.pill,
      onUpdate: (pos, vel) => {
        pillPos = pos;
        pillVel = vel;
        engine.mark(() => draw(pos, vel));
      }
    });
    const squashSpring = createSpring({
      value: 0,
      ...SPRING.press,
      onUpdate: (v) => {
        squash = v;
        engine.mark(() => draw(pillPos, pillVel));
      }
    });
    return {
      buttons() {
        return [...el.querySelectorAll(".dial-seg-btn")];
      },
      setLabel(i, text) {
        const btn = el.querySelectorAll(".dial-seg-btn")[i];
        const span = invRow.children[i];
        if (!btn || !span || btn.textContent === text)
          return;
        btn.textContent = text;
        span.textContent = text;
        width = 0;
        this.measure();
      },
      measure() {
        width = el.offsetWidth || width;
        draw(spring.value, 0);
      },
      set(index) {
        if (!width)
          this.measure();
        const was = on;
        on = index >= 0;
        current = on ? index : null;
        if (on)
          spring.set(index, was);
        else
          draw(spring.value, 0);
      },
      setEnabled(enabled2) {
        el.classList.toggle("is-disabled", !enabled2);
      }
    };
  }

  function snapToDetent(v) {
    for (const p of state.presets)
      if (Math.abs(v - p) <= DETENT)
        return p;
    return v;
  }
  function magnetize(v) {
    if (DBG.noMagnet)
      return v;
    for (const p of state.presets) {
      const d = v - p;
      if (Math.abs(d) < MAGNET)
        return p + d * Math.abs(d) / MAGNET;
    }
    return v;
  }
  function createSlider({ wrap, onInput, onCommit, onFrame, onScrub }) {
    const groove = wrap.querySelector(".dial-groove");
    const fill = wrap.querySelector(".dial-fill");
    const thumb = wrap.querySelector(".dial-thumb");
    const setGroove = compositedStyle(groove);
    const setFill = compositedStyle(fill);
    const setThumb = compositedStyle(thumb);
    let width = 0;
    let dragRect = null;
    let pointer = null;
    let hovering = false;
    let dragging = false;
    function paint() {
      if (!width || DBG.noSliderPaint)
        return;
      const t = (rate.value - MIN_RATE) / (MAX_RATE - MIN_RATE);
      const over = overflow.value;
      const grab = grabbed.value;
      if (!DBG.noGrooveLayout) {
        const h = "4px";
        const left = `${Math.min(0, over).toFixed(2)}px`;
        const right = `${(-Math.max(0, over)).toFixed(2)}px`;
        const sy = `translateY(-50%) scaleY(${(1 + grab * 0.625).toFixed(3)})`;
        setGroove(`${left}|${right}|${sy}`, { height: h, left, right, transform: sy });
      }
      const grooveW = width + Math.abs(over);
      const edge = 8 + (width - 16) * t + Math.max(0, over);
      setFill(`translateX(${(edge - grooveW).toFixed(2)}px)`);
      setThumb(
        `translateX(${((width - 16) * t + over).toFixed(2)}px) scale(${(1 + grab * 0.12).toFixed(3)})`
      );
      onFrame(rate.value);
    }
    const mark = () => engine.mark(paint);
    const rate = createSpring({ value: 1, ...SPRING.rate, onUpdate: mark });
    const overflow = createSpring({ value: 0, ...SPRING.over, onUpdate: mark });
    const grabbed = createSpring({ value: 0, ...SPRING.grab, onUpdate: mark });
    const rateFromPointer = (clientX) => {
      const r = dragRect ?? wrap.getBoundingClientRect();
      const t = (clientX - r.left - 8) / (r.width - 16);
      return MIN_RATE + Math.min(1, Math.max(0, t)) * (MAX_RATE - MIN_RATE);
    };
    const overflowFromPointer = (clientX) => {
      const r = dragRect ?? wrap.getBoundingClientRect();
      if (clientX < r.left)
        return -decay(r.left - clientX);
      if (clientX > r.right)
        return decay(clientX - r.right);
      return 0;
    };
    let moveX = 0;
    let moveFrame = null;
    const processMove = () => {
      moveFrame = null;
      onInput(magnetize(rateFromPointer(moveX)));
      overflow.set(overflowFromPointer(moveX));
    };
    wrap.addEventListener("pointerdown", (e) => {
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
      }
      pointer = e.pointerId;
      dragging = true;
      dragRect = wrap.getBoundingClientRect();
      wrap.classList.add("is-dragging");
      onScrub(true);
      grabbed.set(1);
      moveX = e.clientX;
      processMove();
    });
    wrap.addEventListener("pointermove", (e) => {
      if (pointer !== e.pointerId)
        return;
      moveX = e.clientX;
      if (moveFrame === null)
        moveFrame = requestAnimationFrame(processMove);
    });
    const endDrag = () => {
      if (pointer === null)
        return;
      pointer = null;
      dragging = false;
      if (moveFrame !== null) {
        cancelAnimationFrame(moveFrame);
        moveFrame = null;
      }
      dragRect = null;
      wrap.classList.remove("is-dragging");
      onScrub(false);
      grabbed.set(hovering ? 1 : 0);
      overflow.set(0);
      onInput(snapToDetent(Math.round(rate.value * 100) / 100));
      onCommit();
    };
    wrap.addEventListener("pointerup", endDrag);
    wrap.addEventListener("pointercancel", endDrag);
    wrap.addEventListener("pointerenter", () => {
      hovering = true;
      grabbed.set(1);
    });
    wrap.addEventListener("pointerleave", () => {
      hovering = false;
      if (pointer === null)
        grabbed.set(0);
    });
    wrap.addEventListener("keydown", (e) => {
      const by = e.shiftKey ? 0.1 : 0.01;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown")
        onInput(rate.value - by);
      else if (e.key === "ArrowRight" || e.key === "ArrowUp")
        onInput(rate.value + by);
      else
        return;
      e.preventDefault();
      onCommit();
    });
    return {
      measure() {
        if (wrap.offsetWidth)
          width = wrap.offsetWidth;
        paint();
      },
      set(value, animate = true) {
        if (DBG.noRateSpring)
          return;
        rate.set(value, animate);
      },
      get dragging() {
        return dragging;
      }
    };
  }

  var GAP = 10;
  var SHOW_DELAY_MS = 250;
  var HIDE_GRACE_MS = 120;
  function tooltipShape(w, h, cx, below) {
    const r = TOOLTIP_RADIUS;
    const c = TOOLTIP_CARET;
    const b = h - (below ? 0 : c);
    const t = below ? c : 0;
    if (below) {
      return `M ${cx - c} ${t} L ${cx} 0 L ${cx + c} ${t} L ${w - r} ${t} Q ${w} ${t} ${w} ${t + r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${t + r} Q 0 ${t} ${r} ${t} Z`;
    }
    return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${b - r} Q ${w} ${b} ${w - r} ${b} L ${cx + c} ${b} L ${cx} ${h} L ${cx - c} ${b} L ${r} ${b} Q 0 ${b} 0 ${b - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
  }
  function createTooltip(pop) {
    const el = pop.querySelector(".dial-tooltip");
    const body = el.querySelector(".dial-tip-body");
    const edge = el.querySelector(".dial-tip-edge");
    const path = el.querySelector(".dial-tip-edge path");
    let visible = false;
    let showTimer = null;
    let hideTimer = null;
    let last2 = null;
    function render() {
      const target = last2;
      if (!target)
        return;
      const tip = target.dataset.tip;
      if (!tip)
        return;
      const warn = target.dataset.warn;
      body.innerHTML = `<div>${tip}</div>` + (warn ? `<div class="dial-tooltip-warn">${WARN_ICON}<span>${warn}</span></div>` : "");
      const popRect = pop.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, rect.left - popRect.left + rect.width / 2 - el.offsetWidth / 2),
        popRect.width - el.offsetWidth - 8
      );
      el.style.left = `${left}px`;
      const above = rect.top - popRect.top - el.offsetHeight - GAP;
      const flip = popRect.top + above < 8;
      el.classList.toggle("is-below", flip);
      el.style.top = `${flip ? rect.bottom - popRect.top + GAP : above}px`;
      const centre = rect.left - popRect.left + rect.width / 2 - left;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const d = tooltipShape(
        w,
        h,
        Math.min(Math.max(TOOLTIP_CARET + TOOLTIP_RADIUS, centre), w - TOOLTIP_CARET - TOOLTIP_RADIUS),
        flip
      );
      el.style.clipPath = `path('${d}')`;
      edge.setAttribute("viewBox", `0 0 ${w} ${h}`);
      path.setAttribute("d", d);
      el.classList.add("is-visible");
      visible = true;
    }
    return {
      el,
      show(target) {
        last2 = target;
        if (!target.dataset.tip) {
          this.hide();
          return;
        }
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
          render();
          return;
        }
        if (visible) {
          render();
          return;
        }
        if (showTimer)
          return;
        showTimer = setTimeout(() => {
          showTimer = null;
          render();
        }, SHOW_DELAY_MS);
      },
      hide() {
        if (showTimer) {
          clearTimeout(showTimer);
          showTimer = null;
          return;
        }
        if (!visible || hideTimer)
          return;
        hideTimer = setTimeout(() => {
          hideTimer = null;
          el.classList.remove("is-visible");
          visible = false;
        }, HIDE_GRACE_MS);
      }
    };
  }

  var presetIndex = (rate) => state.presets.findIndex((p) => Math.abs(p - rate) < 5e-3);
  function createPanel() {
    const host = document.createElement("div");
    host.className = "dial-host";
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const injected = document.getElementById("dial")?.textContent;
    if (injected) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(injected);
      shadow.adoptedStyleSheets = [sheet];
    }
    const pop = document.createElement("div");
    pop.className = "dial-pop";
    pop.innerHTML = panelMarkup();
    (injected ? shadow : document.body).appendChild(pop);
    const q = (sel) => pop.querySelector(sel);
    const tooltip = createTooltip(pop);
    const counterEl = q(".dial-counter");
    const counter = createCounter(counterEl);
    const note = createNote(q(".dial-note"), q(".dial-note-text"));
    const noticeEl = q(".dial-notice");
    const advEl = q(".dial-adv");
    const advToggle = q(".dial-adv-toggle");
    const signEl = q(".dial-x");
    const sliderWrap = q(".dial-slider-wrap");
    let open = false;
    let advOpen = false;
    let advHeight = 0;
    let lastNotice = null;
    let lastTimeline = null;
    let lastLabel = "";
    const button = new Spicetify.Playbar.Button(
      "Playback speed",
      GAUGE_ICON,
      () => api3.toggle(),
      false,
      false
    );
    button.tippy.popper.classList.add("dial-tip");
    const needle = createNeedle(() => button.element);
    let dial = null;
    let dialFrame = null;
    let dialX = 0;
    let suppressGaugeClick = false;
    const DIAL_PX_PER_RATE = 120;
    const dialMove = () => {
      dialFrame = null;
      if (!dial?.engaged)
        return;
      const raw = clamp(dial.startRate + (dialX - dial.x) / DIAL_PX_PER_RATE);
      const best = state.presets.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
      if (best !== dial.rate && Math.abs(raw - best) < Math.abs(raw - dial.rate) - 0.03) {
        dial.rate = best;
        needle.dial(best);
      }
    };
    button.element.addEventListener("pointerdown", (e) => {
      if (DBG.noGaugeDial || e.button !== 0)
        return;
      try {
        button.element.setPointerCapture(e.pointerId);
      } catch {
      }
      dial = {
        id: e.pointerId,
        x: e.clientX,
        engaged: false,
        rate: state.presets.reduce((a, b) => Math.abs(b - state.rate) < Math.abs(a - state.rate) ? b : a),
        startRate: state.rate
      };
      dialX = e.clientX;
    });
    button.element.addEventListener("pointermove", (e) => {
      if (!dial || e.pointerId !== dial.id)
        return;
      dialX = e.clientX;
      if (!dial.engaged && Math.abs(dialX - dial.x) > 6) {
        dial.engaged = true;
        suppressGaugeClick = true;
      }
      if (dial.engaged && dialFrame === null)
        dialFrame = requestAnimationFrame(dialMove);
    });
    const endDial = () => {
      if (dialFrame !== null) {
        cancelAnimationFrame(dialFrame);
        dialFrame = null;
      }
      if (!dial)
        return;
      if (dial.engaged) {
        setRate(dial.rate);
        applySpeedSoon();
        setTimeout(() => {
          suppressGaugeClick = false;
        }, 0);
      }
      dial = null;
    };
    button.element.addEventListener("pointerup", endDial);
    button.element.addEventListener("pointercancel", endDial);
    document.addEventListener(
      "click",
      (e) => {
        if (!suppressGaugeClick)
          return;
        e.stopPropagation();
      },
      true
    );
    const slider = createSlider({
      wrap: sliderWrap,
      onInput: setRate,
      onCommit: () => applySpeedSoon(),
      onFrame: (rate) => note.set(rate, state.pitch),
      onScrub: (active2) => note.reveal(active2)
    });
    sliderWrap.addEventListener("pointerenter", () => note.reveal(true));
    sliderWrap.addEventListener("pointerleave", () => {
      if (!slider.dragging)
        note.reveal(false);
    });
    const presetAt = (i) => state.presets[i] ?? 1;
    const presetSeg = createSegmented({
      host: q(".dial-presets-host"),
      items: PRESETS.map((p, i) => ({ value: i, label: p.name })),
      allowNone: true,
      onPick: (i) => {
        const v = presetAt(i);
        if (v === state.rate)
          return;
        setRate(v);
        applySpeedSoon();
      },
      onHover: (el) => tooltip.show(el),
      onLeave: () => tooltip.hide()
    });
    const presetButtons = presetSeg.buttons();
    const pitchSeg = createSegmented({
      host: q(".dial-pitch-host"),
      compact: true,
      items: [
        {
          value: 1,
          label: "Follows speed",
          tip: "Pitch falls with the tempo, like a record slowed on the platter. The real slowed sound."
        },
        {
          value: 0,
          label: "Locked",
          tip: "Holds the original pitch and time-stretches instead, the way podcast speed controls do."
        }
      ],
      onPick: (v) => setPitch(v === 1),
      onHover: (el) => tooltip.show(el),
      onLeave: () => tooltip.hide()
    });
    const timelineSeg = createSegmented({
      host: q(".dial-timeline-host"),
      compact: true,
      items: TIMELINES.map((t) => ({ value: t.id, label: t.name, tip: t.tip, warn: t.warn })),
      onPick: (id) => void setTimeline(id),
      onHover: (el) => tooltip.show(el),
      onLeave: () => tooltip.hide()
    });
    const setAdv = compositedStyle(advEl);
    const setChevron = compositedStyle(advToggle.querySelector(".dial-chev"));
    function drawAdv(progress) {
      if (!advHeight)
        measure();
      advEl.style.height = `${Math.max(0, progress) * advHeight}px`;
      const opacity = String(Math.min(1, Math.max(0, progress)));
      setAdv(opacity, { opacity });
      setChevron(`rotate(${progress * 180}deg)`);
    }
    const advSpring = createSpring({
      value: 0,
      ...SPRING.disclosure,
      onUpdate: (v) => engine.mark(() => drawAdv(v))
    });
    function measure() {
      presetSeg.measure();
      pitchSeg.measure();
      timelineSeg.measure();
      slider.measure();
      counter.measure();
      alignSign(pop, counterEl, signEl);
      const inner = advEl.firstElementChild;
      if (inner?.offsetHeight)
        advHeight = inner.offsetHeight + 1;
      const noticeInner = noticeEl.firstElementChild;
      if (noticeInner) {
        noticeH = NOTICE_GAP + noticeInner.offsetHeight;
        noticeSpring.set(1);
      }
    }
    function place() {
      const r = button.element.getBoundingClientRect();
      const w = pop.offsetWidth;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      pop.style.left = `${left}px`;
      pop.style.bottom = `${window.innerHeight - r.top + 12}px`;
    }
    function noticeText() {
      const kind = getKind();
      if (kind === "podcast")
        return "Podcasts aren't supported. Use Spotify's own speed control for episodes.";
      if (kind === "local")
        return "Local files aren't supported.";
      if (support.speed === false)
        return "This Spotify version doesn't accept the speed key, so playback speed can't be changed.";
      if (support.pitch === false)
        return "This Spotify version doesn't accept the pitch key. Speed still works; pitch always stays locked.";
      return "";
    }
    const NOTICE_GAP = 14;
    const setNotice = compositedStyle(noticeEl);
    let noticeH = 0;
    const noticeSpring = createSpring({
      value: 0,
      ...SPRING.disclosure,
      onUpdate: (v) => engine.mark(() => {
        const p = Math.max(0, Math.min(1, v));
        const o = p.toFixed(3);
        noticeEl.style.height = `${(p * noticeH).toFixed(2)}px`;
        setNotice(o, { opacity: o });
      })
    });
    function drawNotice() {
      const text = noticeText();
      if (text === lastNotice)
        return;
      lastNotice = text;
      noticeEl.innerHTML = text ? `<div class="dial-notice-in">${WARN_ICON}<span>${text}</span></div>` : "";
      pitchSeg.setEnabled(support.pitch !== false && getKind() === "track");
      button.element.classList.toggle("dial-unsupported", support.speed === false);
      const inner = noticeEl.firstElementChild;
      noticeH = inner ? NOTICE_GAP + inner.offsetHeight : 0;
      noticeSpring.set(text ? 1 : 0);
    }
    function render() {
      slider.set(state.rate);
      counter.set(state.rate);
      needle.set(state.rate);
      if (!DBG.noPill)
        presetSeg.set(presetIndex(state.rate));
      pitchSeg.set(state.pitch ? 0 : 1);
      if (state.timeline !== lastTimeline) {
        lastTimeline = state.timeline;
        timelineSeg.set(TIMELINES.findIndex((t) => t.id === state.timeline));
      }
      pop.classList.toggle("is-reduced", reduced());
      valInputs.forEach((input, i) => {
        if (shadow.activeElement === input)
          return;
        const v = presetAt(i).toFixed(2);
        if (input.value !== v)
          input.value = v;
      });
      nameInputs.forEach((input, i) => {
        if (shadow.activeElement === input)
          return;
        const name = state.presetNames[i] ?? PRESETS[i]?.name ?? "";
        if (input.value !== name)
          input.value = name;
        presetSeg.setLabel(i, state.presetNames[i] ?? "");
      });
      drawNotice();
      button.active = state.rate !== 1;
      if (!slider.dragging) {
        const label = state.rate === 1 ? "Playback speed" : `Playback speed - ${state.rate.toFixed(2)}x`;
        if (label !== lastLabel) {
          button.label = label;
          lastLabel = label;
          needle.refresh();
        }
      }
    }
    const readout = q(".dial-readout");
    readout.addEventListener("pointerenter", () => note.reveal(true));
    readout.addEventListener("pointerleave", () => {
      if (!slider.dragging)
        note.reveal(false);
    });
    const PRESET_STEP = 0.05;
    const nameInputs = [...pop.querySelectorAll(".dial-name")];
    const valInputs = [...pop.querySelectorAll(".dial-val")];
    const wireGhost = (input, commit) => {
      input.addEventListener("focus", () => input.select());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter")
          input.blur();
      });
      input.addEventListener("blur", () => commit(input.value));
    };
    nameInputs.forEach(
      (input) => wireGhost(input, (value) => {
        const i = Number(input.dataset.i);
        const name = value.trim().slice(0, 12) || (PRESETS[i]?.name ?? "Preset");
        if (name === state.presetNames[i]) {
          input.value = name;
          return;
        }
        state.presetNames[i] = name;
        save();
        emitChange();
      })
    );
    valInputs.forEach(
      (input) => wireGhost(input, (value) => {
        const i = Number(input.dataset.i);
        const parsed = Number.parseFloat(value);
        const next = Number.isFinite(parsed) ? Math.min(1.5, Math.max(0.5, Math.round(parsed * 100) / 100)) : state.presets[i] ?? 1;
        if (next === state.presets[i]) {
          input.value = next.toFixed(2);
          return;
        }
        state.presets[i] = next;
        save();
        emitChange();
      })
    );
    const stepButtons = [...pop.querySelectorAll(".dial-step")];
    stepButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        const d = Number(btn.dataset.d);
        const next = clamp(Math.round((presetAt(i) + d * PRESET_STEP) * 100) / 100);
        if (next === presetAt(i))
          return;
        state.presets[i] = next;
        save();
        emitChange();
      });
    });
    q(".dial-reset").addEventListener("click", () => {
      setRate(1);
      applySpeedSoon();
    });
    advToggle.addEventListener("click", () => {
      advOpen = !advOpen;
      advToggle.classList.toggle("is-open", advOpen);
      advToggle.setAttribute("aria-expanded", String(advOpen));
      measure();
      advSpring.set(advOpen ? 1 : 0);
      tooltip.hide();
      setTimeout(() => {
        pitchSeg.measure();
        timelineSeg.measure();
      }, 60);
    });
    pop.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => {
      if (!open)
        return;
      const path = e.composedPath();
      if (!path.includes(pop) && !path.includes(button.element))
        api3.toggle(false);
    });
    document.addEventListener("keydown", (e) => {
      if (open && e.key === "Escape")
        api3.toggle(false);
    });
    window.addEventListener("resize", () => {
      if (!open)
        return;
      measure();
      place();
    });
    onChange(render);
    drawAdv(0);
    const api3 = {
      toggle(next) {
        open = next === void 0 ? !open : next;
        pop.classList.toggle("is-open", open);
        if (open) {
          place();
          measure();
          render();
        }
      },
      needle
    };
    slider.set(state.rate, false);
    counter.set(state.rate, false);
    needle.set(state.rate, false);
    render();
    return api3;
  }

  async function main() {
    await untilReady();
    load();
    for (const patch of [
      patchStateSpeed,
      patchEventSpeed,
      patchGetProgress,
      patchTimelineLabels,
      patchShuffle
    ]) {
      try {
        patch();
      } catch (e) {
        console.warn(LOG, `${patch.name} failed`, e);
      }
    }
    const panel = createPanel();
    Spicetify.Player.addEventListener("songchange", (ev) => {
      const data = ev?.data;
      notePlayed(data?.item?.uri ?? Spicetify.Platform.PlayerAPI.getState?.()?.item?.uri);
      if (state.rate !== 1 && atRelayBoundary(data?.item?.uri)) {
        void relayToRealContext();
        clearRanToEnd();
        return;
      }
      const speedOff = Math.abs(currentSpeed() - state.rate) > 5e-3;
      const pitchOff = currentPitchLinked() !== state.pitch;
      const gaplessPitchLost = previousRanToEnd() && state.pitch;
      if (state.rate !== 1 && (speedOff || pitchOff || gaplessPitchLost))
        void applySpeed();
      clearRanToEnd();
    });
    exposeApi(panel);
    console.log(LOG, "ready. Dial.setRate(0.5) to test.");
  }
  function untilReady() {
    return new Promise((resolve) => {
      const check = () => {
        const s = globalThis.Spicetify;
        if (s?.Playbar?.Button && s?.Player?.addEventListener && s?.Platform?.PlayerAPI)
          resolve();
        else
          setTimeout(check, 300);
      };
      check();
    });
  }
  function exposeApi(panel) {
    window.Dial = {
      state,
      currentSpeed,
      apply: applySpeed,
      setRate: (v) => {
        setRate(v);
        return applySpeed();
      },
      setTimeline,
      open: () => panel.toggle(true),
      close: () => panel.toggle(false),
      get support() {
        return { ...support, media: getKind() };
      }
    };
  }

  (async () => {
    await main();
  })();
})();
(async () => {
    if (!document.getElementById(`dial`)) {
      var el = document.createElement('style');
      el.id = `dial`;
      el.textContent = (String.raw`
  @charset "UTF-8";

.dial-needle {
  background: currentColor;
  pointer-events: none;
}
.dial-unsupported {
  opacity: 0.45;
}
.dial-pop {
  --dial-text-1: hsla(0, 0%, 100%, 0.92);
  --dial-text-2: hsla(0, 0%, 100%, 0.6);
  --dial-text-3: hsla(0, 0%, 100%, 0.35);
  --dial-hairline: rgba(255, 255, 255, 0.08);
  --dial-accent: rgba(255, 255, 255, 0.95);
  --dial-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --dial-fast: 0.15s;
  position: fixed;
  z-index: 5000;
  width: 288px;
  padding: 16px;
  border-radius: 16px;
  background: rgba(28, 28, 32, 0.88);
  backdrop-filter: blur(16px) saturate(1.7) brightness(1.06);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.38),
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(255, 255, 255, 0.2),
    0 16px 40px -8px rgba(8, 10, 18, 0.55),
    0 4px 12px -2px rgba(8, 10, 18, 0.35);
  color: var(--dial-text-1);
  font-family: inherit;
  opacity: 0;
  transform: translateY(8px) scale(0.97);
  transform-origin: 50% calc(100% + 12px);
  transition: opacity 0.15s var(--dial-ease), transform 0.15s var(--dial-ease);
  pointer-events: none;
}
.dial-pop.is-open {
  opacity: 1;
  transform: none;
  pointer-events: auto;
  transition: opacity var(--dial-fast) var(--dial-ease), transform 0.25s cubic-bezier(0.2, 1.2, 0.4, 1);
}
.dial-pop button {
  font-family: inherit;
  font-feature-settings: inherit;
}
.dial-pop .dial-seg-btn,
.dial-pop .dial-reset,
.dial-pop .dial-adv-toggle {
  transition: transform 160ms ease-out, color 0.18s var(--dial-ease);
}
.dial-pop .dial-seg-btn:active,
.dial-pop .dial-reset:active,
.dial-pop .dial-adv-toggle:active {
  transform: scale(0.97);
}
.dial-pop .dial-seg-btn.is-held {
  transform: scale(0.94);
}
.dial-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.dial-title {
  font-size: 0.9575rem;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--dial-text-1);
}
.dial-reset {
  border: none;
  background: none;
  padding: 0;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--dial-text-2);
  cursor: pointer;
  transition: color var(--dial-fast) var(--dial-ease);
}
.dial-reset:hover {
  color: var(--dial-text-1);
}
.dial-adv-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 10px;
  padding: 6px 2px;
  border: 0;
  background: none;
  color: var(--dial-text-3);
  font-size: 0.76rem;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--dial-fast) var(--dial-ease);
}
.dial-adv-toggle:hover {
  color: var(--dial-text-2);
}
.dial-chev {
  flex: none;
}
.dial-adv {
  overflow: hidden;
  height: 0;
  opacity: 0;
}
.dial-adv-inner {
  display: flow-root;
}
.dial-adv-inner > .dial-sub:first-child {
  margin-top: 2px;
}
.dial-sub {
  margin: 15px 0 7px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--dial-text-3);
}
.dial-pop.t-off-ticks .dial-ticks {
  display: none;
}
.dial-preset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 9px;
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--dial-text-2);
}
.dial-name {
  width: 9ch;
  min-width: 3ch;
  border: none;
  background: none;
  padding: 0;
  color: var(--dial-text-2);
  font-size: 0.76rem;
  font-weight: 500;
  font-family: inherit;
  outline: none;
  caret-color: var(--dial-text-1);
  transition: color 0.18s var(--dial-ease);
}
.dial-name:hover,
.dial-name:focus {
  color: var(--dial-text-1);
}
.dial-val {
  width: 4.4ch;
  border: none;
  background: none;
  padding: 0;
  color: var(--dial-text-1);
  font-size: 0.8rem;
  font-weight: 600;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
  transition: color 0.18s var(--dial-ease);
}
.dial-stepper {
  display: flex;
  align-items: center;
  gap: 2px;
}
.dial-step {
  border: none;
  background: none;
  padding: 2px 7px;
  font-size: 0.9rem;
  line-height: 1.2;
  color: var(--dial-text-2);
  cursor: pointer;
  transition: transform 160ms ease-out, color 0.18s var(--dial-ease);
}
.dial-step:hover {
  color: var(--dial-text-1);
}
.dial-step:active {
  transform: scale(0.9);
}
.dial-step-val {
  min-width: 3.2ch;
  text-align: center;
  font-size: 0.8rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--dial-text-1);
}
.dial-seg-btn {
  user-select: none;
}
@media (prefers-reduced-motion: reduce) {
  .dial-pop,
  .dial-tooltip,
  .dial-seg-btn,
  .dial-reset,
  .dial-adv-toggle {
    transition: opacity 0.2s ease;
    transform: none;
  }
}
.dial-pop.is-reduced,
.dial-pop.is-reduced .dial-tooltip,
.dial-pop.is-reduced .dial-seg-btn,
.dial-pop.is-reduced .dial-reset,
.dial-pop.is-reduced .dial-adv-toggle {
  transition: opacity 0.2s ease;
  transform: none;
}
@media (prefers-reduced-transparency: reduce) {
  .dial-pop,
  .dial-tooltip {
    background: rgba(28, 28, 32, 0.97);
    backdrop-filter: none;
  }
}
@media (prefers-contrast: more) {
  .dial-pop,
  .dial-tooltip {
    background: rgb(24, 24, 28);
    backdrop-filter: none;
    outline: 1px solid rgba(255, 255, 255, 0.55);
  }
}
.dial-readout {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 5px;
  margin-top: 0;
}
.dial-counter {
  position: relative;
  display: flex;
  align-items: center;
  font-size: 2rem;
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--dial-text-1);
}
.dial-note-text {
  font-variant-numeric: tabular-nums;
}
.dial-digit {
  position: relative;
  display: inline-block;
  width: calc(1ch - 0.02em);
  height: 1em;
  overflow: hidden;
  contain: strict;
}
.dial-strip {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  will-change: transform;
}
.dial-num {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 1em;
}
.dial-dot {
  display: inline-block;
  width: 0.32ch;
  text-align: center;
}
.dial-x {
  font-size: 1.15rem;
  font-weight: 500;
  line-height: 1;
  transform: translateY(var(--sign-shift, 1px));
  color: var(--dial-text-3);
}
.dial-note {
  position: absolute;
  right: 0;
  bottom: 2px;
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
}
.dial-note-text {
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--dial-text-3);
  white-space: nowrap;
  contain: layout paint style;
}
.dial-slider-wrap {
  position: relative;
  height: 22px;
  margin-top: 12px;
  display: flex;
  align-items: center;
  touch-action: none;
  cursor: grab;
  outline: none;
}
.dial-slider-wrap.is-dragging {
  cursor: grabbing;
}
.dial-slider-wrap:focus-visible .dial-thumb {
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(0, 0, 0, 0.18),
    0 0 0 4px rgba(255, 255, 255, 0.25);
}
.dial-groove {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  transform-origin: 50% 50%;
  will-change: transform;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 0 0 1px var(--dial-hairline);
  pointer-events: none;
  contain: strict;
}
.dial-fill {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--dial-accent);
}
.dial-thumb {
  position: absolute;
  left: 0;
  top: 50%;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border-radius: 50%;
  background: #fff;
  pointer-events: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.18);
  transform-origin: center center;
}
.dial-seg {
  position: relative;
  display: grid;
  margin-top: 16px;
  padding: 4px;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.25);
  box-shadow: inset 0 0 0 1px var(--dial-hairline);
  --seg-h: 32px;
}
.dial-seg.is-disabled {
  opacity: 0.4;
  pointer-events: none;
}
.dial-seg.is-compact {
  --seg-h: 28px;
}
.dial-seg.is-compact .dial-seg-btn,
.dial-seg.is-compact .dial-seg-inv-row span {
  font-size: 0.76rem;
}
.dial-adv-inner .dial-seg {
  margin-top: 0;
}
.dial-seg-pill {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  border-radius: 8px;
  background: var(--dial-accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.38);
  pointer-events: none;
  transform-origin: center center;
  will-change: transform;
  transition: opacity 0.18s var(--dial-ease);
}
.dial-seg-btn {
  position: relative;
  z-index: 1;
  height: var(--seg-h);
  padding: 0;
  border: 0;
  background: none;
  color: var(--dial-text-2);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.18s var(--dial-ease);
}
.dial-seg-btn:hover {
  color: var(--dial-text-1);
}
.dial-seg-inv {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  z-index: 2;
  overflow: hidden;
  border-radius: 8px;
  pointer-events: none;
  will-change: transform;
  transition: opacity 0.18s var(--dial-ease);
}
.dial-seg-inv-row {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: grid;
  will-change: transform;
}
.dial-seg-inv-row span {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  font-size: 0.78rem;
  font-weight: 500;
  transition: transform 160ms ease-out;
}
.dial-seg-inv-row span.is-held {
  transform: scale(0.94);
}
.dial-notice {
  overflow: hidden;
  height: 0;
}
.dial-notice-in {
  display: flex;
  gap: 7px;
  margin-top: 14px;
  padding: 9px 10px;
  border-radius: 9px;
  background: rgba(255, 183, 77, 0.09);
  box-shadow: inset 0 0 0 1px rgba(255, 183, 77, 0.2);
  color: rgba(255, 205, 138, 0.92);
  font-size: 0.72rem;
  line-height: 1.4;
}
.dial-notice-in svg {
  flex: none;
  margin-top: 2px;
}
.dial-tooltip {
  position: absolute;
  z-index: 20;
  width: 206px;
  padding: 9px 11px 16px;
  --tip-tint:
    28,
    28,
    32;
  --tip-alpha: 0.46;
  --tip-blur: 30px;
  background: rgba(var(--tip-tint), var(--tip-alpha));
  backdrop-filter: blur(var(--tip-blur)) saturate(1.7) brightness(1.06);
  filter: drop-shadow(0 10px 22px rgba(8, 10, 18, 0.55)) drop-shadow(0 3px 8px rgba(8, 10, 18, 0.38));
  color: var(--dial-text-2);
  font-size: 0.7rem;
  line-height: 1.45;
  font-weight: 400;
  text-align: left;
  opacity: 0;
  pointer-events: none;
  transform: translateY(3px);
  transition: opacity var(--dial-fast) var(--dial-ease), transform var(--dial-fast) var(--dial-ease);
}
.dial-tooltip.is-visible {
  opacity: 1;
  transform: none;
}
.dial-tooltip.is-below {
  padding: 16px 11px 9px;
}
.dial-tip-edge {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.dial-tip-body {
  position: relative;
}
.dial-tooltip-warn {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 195, 120, 0.9);
}
.dial-tooltip-warn svg {
  flex: none;
  margin-top: 2px;
}
[data-testid=progress-label][data-dial-other]::after {
  content: " \b7  " attr(data-dial-other);
  opacity: 0.66;
  font-variant-numeric: tabular-nums;
}
[data-testid=progress-label][data-dial-main] {
  font-size: 0;
}
[data-testid=progress-label][data-dial-main]::before {
  content: attr(data-dial-main);
  font-size: 13px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
[data-testid=progress-label][data-dial-main][data-dial-other]::after {
  font-size: 13px;
  line-height: 16px;
}
.dial-tip .main-contextMenu-tippy {
  box-sizing: border-box;
  max-width: 458px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--spice-card, #282828);
  color: var(--spice-text, #fff);
  font-size: 14px;
  line-height: normal;
  box-shadow: 0 16px 24px rgba(0, 0, 0, 0.3), 0 6px 8px rgba(0, 0, 0, 0.2);
}

      `).trim();
      document.head.appendChild(el);
    }
  })()
      })();
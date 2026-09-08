window.onerror = function (msg) {
  var el = document.getElementById('jsAlive');
  if (el) { el.style.color = '#B3403A'; el.textContent = '오류: ' + msg + ' — 이 문구를 그대로 전달해 주세요'; }
};
(function () {
  'use strict';
  var alive = document.getElementById('jsAlive');
  if (alive) { alive.style.color = '#3E7A52'; alive.textContent = '✓ 준비 완료 — 버튼이 동작합니다 (v0.6.4)'; }
  var S = { screen: 'start', recording: false, noRecord: false, startedAt: 0, alerts: 0, answers: {}, callMin: 15, callAt: 0, snoozed: false, cooldownUntil: 0, taps: [], tapT: 0,
            buddy: '', buddyManual: false, rid: '', reqTo: '', reqAt: 0, acc: null };
  var analyser = null, audioCtx = null, micStream = null;
  var timerId = 0, cdId = 0, ringId = 0, ringOsc = null, wakeLock = null;
  var canvas = document.getElementById('wave'), ctx = canvas.getContext('2d');
  var BARS = 40;
  var baseline = 0.02, loudSince = 0;

  function $(id) { return document.getElementById(id); }
  function fmt(s) { var m = Math.floor(s/60), r = Math.floor(s%60); return (m<10?'0':'')+m+':'+(r<10?'0':'')+r; }

  // ---------- 설정 (기기 안에만 저장) ----------
  var DEF = {
    n1: '상담 내용은 글로 기록되어 상담자와 기관이 보관합니다. 음성은 글로 바뀐 뒤 바로 지워집니다.',
    n2: '글로 바꾸고 정리하기 위해 대화 내용이 외부 음성인식·AI 서비스로 전송됩니다.',
    n3: '기록은 상담 지원과 안전을 위해서만 쓰며, 원하시면 열람·정정·삭제를 요청할 수 있습니다.',
    refuse: '기록에 동의하지 않으시면 오늘 상담 진행이 어렵습니다. 담당자와 상의해 다음 상담 일정을 다시 잡아드립니다.',
    approved: false,
    grace: 10,
    sens: 'mid',
    threat: '가만 안, 가만히 안, 죽여, 죽인다, 죽일, 때려 버, 때린다, 패버리, 패 버릴, 칼로, 칼 들, 불 지르, 불질러, 찾아간다, 찾아갈, 찾아온다, 퇴근길 조심, 밤길 조심, 조심해라, 묻어버리, 없애버리, 해코지, 각오해, 부숴버, 박살 내',
    abuse: '씨발, 시발, 씨팔, 개새끼, 새끼야, 이런 새끼, 이 새끼, 저 새끼, 병신, 미친놈, 미친년, 지랄, 엿 먹, 꺼져, 닥쳐, 등신, 또라이, 개같은, 좆',
    provider: 'gemini',
    gkey: '', gmodel: 'gemini-2.5-flash',
    key: '', model: 'claude-opus-5',
    warn: '폭언이 계속되면 상담이 중단될 수 있습니다. 상담 내용은 기록되고 있습니다.'
  };
  var CFG = loadCfg();
  function loadCfg() {
    var c = {}; try { c = JSON.parse(localStorage.getItem('ma_cfg') || '{}') || {}; } catch (e) { c = {}; }
    var out = {}; Object.keys(DEF).forEach(function (k) { out[k] = (k in c) ? c[k] : DEF[k]; });
    return out;
  }
  function saveCfg() { try { localStorage.setItem('ma_cfg', JSON.stringify(CFG)); } catch (e) {} }
  function listToRx(s) {
    var parts = String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!parts.length) return null;
    var alts = parts.map(function (p) { return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'); });
    return new RegExp('(' + alts.join('|') + ')');
  }
  var RX_THREAT = null, RX_ABUSE = null;
  function applyCfg() {
    RX_THREAT = listToRx(CFG.threat); RX_ABUSE = listToRx(CFG.abuse);
    var t = ['noticeN1', 'noticeN2', 'noticeN3'], v = [CFG.n1, CFG.n2, CFG.n3];
    t.forEach(function (id, i) { var el = $(id); if (el) el.textContent = v[i]; });
    var nr = $('norecTxt'); if (nr) nr.textContent = CFG.refuse;
    document.querySelectorAll('.demoChip, .demoNote').forEach(function (el) { el.style.display = CFG.approved ? 'none' : ''; });
    var ai = $('aiStat'); if (ai) ai.textContent = aiKey() ? '켜짐 · ' + modelLabel(aiModel()) : '꺼짐 · 키 없음';
  }
  // 현재 고른 AI 회사의 키·모델
  function aiKey() { return CFG.provider === 'anthropic' ? CFG.key : CFG.gkey; }
  function aiModel() { return CFG.provider === 'anthropic' ? CFG.model : CFG.gmodel; }
  function modelLabel(m) {
    return m === 'claude-haiku-4-5' ? 'Claude Haiku 4.5' : m === 'claude-sonnet-5' ? 'Claude Sonnet 5' : m === 'claude-opus-5' ? 'Claude Opus 5'
      : m === 'gemini-2.5-flash-lite' ? 'Gemini 2.5 Flash-Lite' : 'Gemini 2.5 Flash';
  }
  var formKeys = { gemini: '', anthropic: '' }, formProvider = 'gemini';
  window.openSettings = function () {
    $('cfgN1').value = CFG.n1; $('cfgN2').value = CFG.n2; $('cfgN3').value = CFG.n3; $('cfgRefuse').value = CFG.refuse;
    $('cfgThreat').value = CFG.threat; $('cfgAbuse').value = CFG.abuse; $('cfgWarn').value = CFG.warn;
    formKeys = { gemini: CFG.gkey, anthropic: CFG.key };
    $('swApproved').classList.toggle('on', !!CFG.approved);
    $('swApprovedTxt').textContent = CFG.approved ? '기관 승인 완료' : '기관 승인 전';
    document.querySelectorAll('#s-settings [data-grace]').forEach(function (p) { p.classList.toggle('on', parseInt(p.getAttribute('data-grace'), 10) === CFG.grace); });
    document.querySelectorAll('#s-settings [data-sens]').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-sens') === CFG.sens); });
    document.querySelectorAll('#modelRowG [data-model]').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-model') === CFG.gmodel); });
    document.querySelectorAll('#modelRowA [data-model]').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-model') === CFG.model); });
    showProvider(CFG.provider || 'gemini');
    $('cfgMsg').textContent = ''; $('keyMsg').textContent = '키는 이 기기 안에만 저장돼요. 키가 없으면 맥락 분석과 기록 초안만 꺼지고 나머지는 그대로 동작해요.'; $('keyMsg').style.color = '';
    go('settings');
    $('s-settings').scrollTop = 0;
  };
  function showProvider(p) {
    formProvider = p;
    document.querySelectorAll('#s-settings [data-provider]').forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-provider') === p); });
    $('modelRowG').style.display = p === 'gemini' ? 'flex' : 'none';
    $('modelRowA').style.display = p === 'anthropic' ? 'flex' : 'none';
    $('cfgKey').value = formKeys[p] || '';
    $('cfgKey').placeholder = p === 'gemini' ? 'Gemini API 키 (AIza…)' : 'Anthropic API 키 (sk-ant-…)';
    $('keyHelp').textContent = p === 'gemini'
      ? 'Gemini 키: aistudio.google.com → "Get API key" (카드 없이 무료). 무료 등급은 구글이 입력 내용을 서비스 개선에 쓸 수 있어요 — 시연·연습용으로만 쓰고, 파일럿 전에 유료 등급이나 기관 방침 확인이 필요해요.'
      : 'Anthropic 키: console.anthropic.com에서 발급, 소액 충전 필요. API로 보낸 내용은 학습에 쓰지 않아요.';
  }
  window.pickProvider = function (el) {
    formKeys[formProvider] = $('cfgKey').value.trim();
    showProvider(el.getAttribute('data-provider'));
  };
  window.toggleApproved = function () {
    var on = !$('swApproved').classList.contains('on');
    $('swApproved').classList.toggle('on', on);
    $('swApprovedTxt').textContent = on ? '기관 승인 완료' : '기관 승인 전';
  };
  function pickOne(el, attr) { el.parentElement.querySelectorAll('.pill').forEach(function (p) { p.classList.remove('on'); }); el.classList.add('on'); return el.getAttribute(attr); }
  window.pickGrace = function (el) { pickOne(el, 'data-grace'); };
  window.pickSens = function (el) { pickOne(el, 'data-sens'); };
  window.pickModel = function (el) { pickOne(el, 'data-model'); };
  function readSettingsForm() {
    formKeys[formProvider] = $('cfgKey').value.trim();
    var g = document.querySelector('#s-settings [data-grace].on'), s = document.querySelector('#s-settings [data-sens].on');
    var mg = document.querySelector('#modelRowG [data-model].on'), ma = document.querySelector('#modelRowA [data-model].on');
    return {
      n1: $('cfgN1').value.trim() || DEF.n1, n2: $('cfgN2').value.trim() || DEF.n2, n3: $('cfgN3').value.trim() || DEF.n3,
      refuse: $('cfgRefuse').value.trim() || DEF.refuse,
      approved: $('swApproved').classList.contains('on'),
      grace: g ? parseInt(g.getAttribute('data-grace'), 10) : DEF.grace,
      sens: s ? s.getAttribute('data-sens') : DEF.sens,
      threat: $('cfgThreat').value.trim(), abuse: $('cfgAbuse').value.trim(),
      provider: formProvider,
      gkey: formKeys.gemini || '', gmodel: mg ? mg.getAttribute('data-model') : DEF.gmodel,
      key: formKeys.anthropic || '', model: ma ? ma.getAttribute('data-model') : DEF.model,
      warn: $('cfgWarn').value.trim() || DEF.warn
    };
  }
  window.saveSettings = function () {
    CFG = readSettingsForm(); saveCfg(); applyCfg();
    $('cfgMsg').textContent = '저장됐어요 (' + hhmm() + ')';
    setTimeout(function () { if (S.screen === 'settings') go('start'); }, 700);
  };
  window.resetSettings = function () {
    formKeys[formProvider] = $('cfgKey').value.trim();
    var keep = { gkey: formKeys.gemini, key: formKeys.anthropic, provider: formProvider };
    CFG = loadCfg(); Object.keys(DEF).forEach(function (k) { CFG[k] = DEF[k]; });
    CFG.gkey = keep.gkey; CFG.key = keep.key; CFG.provider = keep.provider;
    openSettings();
    $('cfgMsg').textContent = '기본값으로 되돌렸어요 — "저장"을 눌러야 적용돼요 (키는 그대로)';
  };
  // AI 연결 확인: 브라우저에서 직접 호출 (시연용). 키는 요청 헤더로만 나가고 어디에도 기록되지 않는다.
  window.checkKey = function () {
    var f = readSettingsForm(), b = $('keyCheck'), msg = $('keyMsg');
    var key = f.provider === 'anthropic' ? f.key : f.gkey, model = f.provider === 'anthropic' ? f.model : f.gmodel;
    if (!key) { msg.textContent = '키를 먼저 넣어 주세요'; msg.style.color = '#B3403A'; return; }
    b.textContent = '확인 중…'; b.disabled = true;
    askAI(f.provider, key, model, '연결 확인입니다. "확인"이라고만 답하세요.', 16).then(function (r) {
      msg.textContent = '✓ 연결됐어요 · ' + modelLabel(model) + ' · 응답: ' + (r.text || '').slice(0, 20) + ' · 저장을 눌러 주세요';
      msg.style.color = '#3E7A52';
    }).catch(function (e) {
      msg.textContent = '연결 실패: ' + (e && e.message ? e.message : e);
      msg.style.color = '#B3403A';
    }).then(function () { b.textContent = '연결 확인'; b.disabled = false; });
  };
  function askAI(provider, key, model, prompt, maxTokens) {
    return provider === 'anthropic' ? askClaude(key, model, prompt, maxTokens) : askGemini(key, model, prompt, maxTokens);
  }
  function askGemini(key, model, prompt, maxTokens) {
    return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens || 256 } })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
        var c = (j.candidates && j.candidates[0]) || {};
        var text = ((c.content && c.content.parts) || []).map(function (p) { return p.text || ''; }).join('');
        return { text: text, stop: c.finishReason };
      });
    });
  }
  function askClaude(key, model, prompt, maxTokens) {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: model, max_tokens: maxTokens || 256, messages: [{ role: 'user', content: prompt }] })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
        var text = (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
        return { text: text, stop: j.stop_reason };
      });
    });
  }
  window.go = function (name) {
    document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('on'); });
    $('s-'+name).classList.add('on');
    S.screen = name;
    if (name === 'session') sizeCanvas();
  };
  window.tgl = function (el) { el.classList.toggle('ok'); };
  window.pickCall = function (el) {
    document.querySelectorAll('#s-checkin .pill').forEach(function (p) { p.classList.remove('on'); });
    el.classList.add('on');
    S.callMin = parseInt(el.getAttribute('data-min'), 10);
  };

  // ---------- session ----------
  window.startSession = function (withRecord) {
    // 수락 게이트: 업무폰 동료가 수락한 상태가 아니면 마이크·기록을 켜지 않는다
    if (!S.acc) { go('checkin'); return; }
    S.noRecord = !withRecord;
    S.startedAt = Date.now();
    S.alerts = 0;
    S.tr = [];
    S.counselor = ($('counselorName').value || '').trim() || '-';
    S.client = ($('clientName').value || '').trim() || '-';
    try { localStorage.setItem('ma_counselor', S.counselor); } catch (e) {}
    S.cooldownUntil = Date.now() + 20000;
    $('stateChip').className = 'chip calm';
    $('stateTxt').textContent = '연결됨 · ' + S.acc.name;
    if (S.callMin > 0) { S.callAt = Date.now() + S.callMin * 60000; $('callChip').style.display = 'flex'; }
    else { S.callAt = 0; $('callChip').style.display = 'none'; }
    if (withRecord) {
      $('recLabel').textContent = '기록 중';
      $('mainMsg').innerHTML = '이 상담은<br>기록되고 있습니다';
      initMic();
      startSTT();
    } else {
      $('recLabel').textContent = '기록 없음';
      $('mainMsg').innerHTML = '편안하게<br>말씀 나누세요';
    }
    go('session');
    hostSubscribe();
    var c0 = linkCfg();
    if (c0 && c0.role === 'host') {
      postSig({ type: 'start', rid: S.acc.rid, to: S.acc.name, place: c0.place, who: S.counselor, at: S.startedAt });
      clearInterval(hbId);
      hbId = setInterval(function () {
        var c1 = linkCfg();
        if (c1 && c1.role === 'host' && S.acc && (S.screen === 'session' || S.screen === 'countdown' || S.screen === 'alert' || S.screen === 'call' || S.screen === 'incall')) {
          postSig({ type: 'hb', rid: S.acc.rid, to: S.acc.name, place: c1.place, who: S.counselor, at: S.startedAt });
        }
      }, 300000);
    }
    clearInterval(timerId);
    timerId = setInterval(tick, 400);
    if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    draw();
  };

  function tick() {
    var el = Math.floor((Date.now() - S.startedAt) / 1000);
    $('timer').textContent = fmt(el);
    if (S.callAt && Date.now() >= S.callAt && S.screen === 'session') startRing();
    if (S.callAt) $('callLeft').textContent = fmt(Math.max(0, Math.ceil((S.callAt - Date.now()) / 1000)));
  }

  // ---------- 대화 기록 (음성 인식, ko-KR) ----------
  var stt = null, sttActive = false;
  function startSTT() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || S.noRecord) return;
    stt = new SR();
    stt.lang = 'ko-KR'; stt.continuous = true; stt.interimResults = false;
    stt.onresult = function (e) {
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          var x = (e.results[i][0].transcript || '').trim();
          if (x) {
            S.tr.push({ t: fmt(Math.floor((Date.now() - S.startedAt) / 1000)), x: x });
            checkThreat(x);
          }
        }
      }
    };
    stt.onend = function () { if (sttActive) setTimeout(function () { try { stt.start(); } catch (e) {} }, 300); };
    stt.onerror = function (e) { if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) sttActive = false; };
    sttActive = true;
    try { stt.start(); } catch (e) {}
  }
  function stopSTT() { sttActive = false; if (stt) { try { stt.stop(); } catch (e) {} stt = null; } }

  // ---------- 위협 단어 감지 (기기 안에서 텍스트 매칭) ----------
  // 위협 표현·심한 말 목록은 설정(②)에서 온다 → applyCfg()가 RX_THREAT / RX_ABUSE를 만든다
  function checkThreat(x) {
    if (S.screen !== 'session' || Date.now() <= S.cooldownUntil) return;
    if (RX_THREAT && RX_THREAT.test(x)) triggerCountdown('위협하는 말이');
    else if (RX_ABUSE && RX_ABUSE.test(x)) triggerCountdown('심한 말이');
  }

  // ---------- 경고 음성 (기기 내장 음성합성, 무료) ----------
  window.playWarning = function (btn) {
    try {
      var text = (S.screen === 'settings' && $('cfgWarn').value.trim()) || CFG.warn || DEF.warn;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 0.95; u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      if (btn) {
        btn.textContent = '재생 중…';
        var label = btn.textContent === '들어보기' || btn.textContent === '재생 중…' && S.screen === 'settings' ? '들어보기' : '경고 음성';
        btn.textContent = '재생 중…';
        var revert = function () { btn.textContent = label; };
        u.onend = revert; u.onerror = revert;
        setTimeout(revert, 8000);
      }
      if (S.screen !== 'settings') S.tr.push({ t: fmt(Math.floor((Date.now() - S.startedAt) / 1000)), x: '[경고 안내 음성 재생됨]' });
    } catch (e) {}
  };

  function initMic() {
    if (analyser || S.noRecord) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micStream = stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
    }).catch(function () {});
  }

  function sizeCanvas() {
    var dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  }

  function rmsNow() {
    if (!analyser) return null;
    var d = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(d);
    var sum = 0;
    for (var i = 0; i < d.length; i++) { var v = (d[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / d.length);
  }

  function draw() {
    requestAnimationFrame(draw);
    if (S.screen !== 'session') return;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var rms = rmsNow(), t = performance.now() / 1000;
    var data = null;
    if (analyser) { data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); }
    var gap = w / BARS;
    for (var i = 0; i < BARS; i++) {
      var lv = data ? data[Math.floor(i / BARS * data.length * 0.6)] / 255
                    : 0.16 + 0.12 * Math.abs(Math.sin(t * 1.3 + i * 0.5));
      var bh = Math.max(h * 0.05, lv * h * 0.9);
      ctx.fillStyle = lv > 0.62 ? '#A34A1E' : '#E0A57E';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(i * gap + gap * 0.24, (h - bh) / 2, gap * 0.52, bh, 6); else ctx.rect(i * gap + gap * 0.24, (h - bh) / 2, gap * 0.52, bh);
      ctx.fill();
    }
    // 감지 v1: 지속되는 고성 (음량 기반, 100% 로컬)
    if (rms !== null && Date.now() > S.cooldownUntil) {
      baseline = baseline * 0.999 + rms * 0.001;
      var sens = CFG.sens === 'low' ? [0.13, 4.0] : CFG.sens === 'high' ? [0.08, 2.5] : [0.10, 3.2];
      var threshold = Math.max(sens[0], baseline * sens[1]);
      if (rms > threshold) {
        if (!loudSince) loudSince = Date.now();
        if (Date.now() - loudSince > 1500) triggerCountdown('계속되는 큰 소리가');
      } else if (rms < threshold * 0.7) { loudSince = 0; }
    }
  }

  // ---------- 숨은 수동 트리거: 상태 칩 3연타 ----------
  window.secretTap = function () {
    var now = Date.now();
    if (now - S.tapT > 1200) S.taps = [];
    S.tapT = now; S.taps.push(now);
    if (S.taps.length >= 3 && S.screen === 'session') { S.taps = []; triggerCountdown(); }
  };
  window.manualAlert = function () { if (S.screen === 'session') fireAlert('manual'); };

  // ---------- 유예 카운트다운 ----------
  var cdLeft = 10;
  function triggerCountdown(reason) {
    if (S.screen !== 'session') return;
    loudSince = 0;
    S.cooldownUntil = Date.now() + 45000;
    cdLeft = CFG.grace || 10; $('cdNum').textContent = String(cdLeft);
    $('cdReason').textContent = reason || '계속되는 큰 소리가';
    go('countdown');
    if (navigator.vibrate) navigator.vibrate(150);
    clearInterval(cdId);
    cdId = setInterval(function () {
      cdLeft -= 1;
      $('cdNum').textContent = String(Math.max(0, cdLeft));
      if (cdLeft <= 0) { clearInterval(cdId); fireAlert('timeout'); }
    }, 1000);
  }
  window.cancelAlert = function () { clearInterval(cdId); go('session'); };
  window.fireAlert = function (how) {
    clearInterval(cdId);
    S.alerts += 1;
    $('stateChip').className = 'chip warn';
    $('stateTxt').textContent = '감지 ' + S.alerts + '회';
    var elapsed = fmt(Math.floor((Date.now() - S.startedAt) / 1000));
    $('alertTime').textContent = elapsed;
    $('alertTitle').textContent = how === 'manual' ? '동료를 호출했어요' : '동료에게 알렸어요';
    var c = linkCfg();
    if (c && c.role === 'host') {
      postSig({ type: 'alert', rid: S.acc ? S.acc.rid : '', to: S.acc ? S.acc.name : '', place: c.place || '상담실', who: S.counselor || '', t: elapsed, ts: Date.now() }).then(function (ok) {
        if (S.screen === 'alert' && !ok) $('ackLine').textContent = '신호를 보내지 못했어요 — 인터넷 연결을 확인하고 "동료 호출"을 다시 눌러 주세요';
      });
      $('ackLine').textContent = (S.acc ? S.acc.name + ' 선생님 업무폰' : '동료 기기') + '으로 신호를 보냈어요 — 응답 대기 중…';
    } else {
      $('ackLine').textContent = '동료 연결이 설정되지 않아 이 기기에만 표시돼요 (시작 화면 → 동료 연결 설정)';
    }
    go('alert');
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  };
  window.cancelFromAlert = function () { var c = linkCfg(); postSig({ type: 'cancel', rid: S.acc ? S.acc.rid : '', place: (c && c.place) || '' }); go('session'); };

  // ---------- 확인 전화 ----------
  function startRing() {
    S.callAt = 0;
    go('call');
    playRing(true);
  }
  function playRing(on) {
    clearInterval(ringId);
    if (ringOsc) { try { ringOsc.stop(); } catch (e) {} ringOsc = null; }
    if (!on) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var ac = audioCtx;
    function burst() {
      if (S.screen !== 'call') { playRing(false); return; }
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.85);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.9);
      var o2 = ac.createOscillator(), g2 = ac.createGain();
      o2.type = 'sine'; o2.frequency.value = 660;
      g2.gain.setValueAtTime(0.0001, ac.currentTime + 0.45);
      g2.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + 0.5);
      g2.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.85);
      o2.connect(g2); g2.connect(ac.destination);
      o2.start(ac.currentTime + 0.45); o2.stop(ac.currentTime + 0.9);
      if (navigator.vibrate) navigator.vibrate([300, 200, 300]);
    }
    burst();
    ringId = setInterval(burst, 2000);
  }
  window.answerCall = function () { playRing(false); go('incall'); };
  window.snoozeCall = function () { playRing(false); S.callAt = Date.now() + 10 * 60000; $('callChip').style.display = 'flex'; go('session'); };

  // ---------- 종료 · 관찰 ----------
  window.endSession = function () {
    clearInterval(timerId); playRing(false); clearInterval(cdId); stopSTT();
    var cE = linkCfg();
    if (cE && cE.role === 'host') postSig({ type: 'end', rid: S.acc ? S.acc.rid : '', place: cE.place, who: S.counselor });
    S.acc = null; S.rid = '';
    clearInterval(hbId);
    hostUnsubscribe();
    var mins = Math.round((Date.now() - S.startedAt) / 60000);
    $('wrapSummary').textContent = '상담 ' + mins + '분 · 위험 신호 ' + S.alerts + '건 · 음성 저장 없음';
    S.answers = {};
    document.querySelectorAll('#s-wrap .qrow .pill').forEach(function (p) { p.classList.remove('on'); });
    syncTypePills();
    go('wrap');
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; analyser = null; }
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  };
  window.ans = function (el, q, v) {
    el.parentElement.querySelectorAll('.pill').forEach(function (p) { p.classList.remove('on'); });
    el.classList.add('on');
    S.answers['q' + q] = v;
  };
  window.finish = function (save) {
    if (save) {
      try {
        var arr = getObs();
        arr.push({
          d: new Date().toISOString().slice(0, 16),
          min: Math.round((Date.now() - S.startedAt) / 60000),
          alerts: S.alerts, noRec: S.noRecord, a: S.answers,
          c1: S.counselor || '-', c2: S.client || '-',
          one: S.stype || '',
          tr: S.tr || []
        });
        localStorage.setItem('ma_obs', JSON.stringify(arr));
      } catch (e) {}
    }
    updateObsCount();
    go('start');
  };
  // 상담 유형: 시작 화면(이름 입력)과 종료 화면 양쪽에 같은 4종. 고른 값은 다음 상담의 기본값이 된다.
  window.pickType = function (el) {
    S.stype = el.textContent;
    try { localStorage.setItem('ma_stype', S.stype); } catch (e) {}
    syncTypePills();
  };
  function syncTypePills() {
    document.querySelectorAll('#typeRow .pill, #typeRow2 .pill').forEach(function (p) { p.classList.toggle('on', p.textContent === S.stype); });
    var t = $('lastType'); if (t) t.textContent = S.stype || '유형 미선택';
  }
  // ---------- 2a 이름 입력 ----------
  window.openName = function () {
    var c = linkCfg();
    try { S.stype = localStorage.getItem('ma_stype') || ''; } catch (e) { S.stype = ''; }
    var who = ($('counselorName').value || '').trim();
    $('clientName').value = '';
    $('lastCounselor').textContent = who || '이름 없음';
    $('lastPlace').textContent = (c && c.place) || '장소 미설정';
    syncTypePills();
    $('lastEdit').style.display = (who && S.stype) ? 'none' : 'block';
    nameChanged();
    go('name');
    setTimeout(function () { try { $('clientName').focus(); } catch (e) {} }, 50);
  };
  window.toggleLast = function () { var e = $('lastEdit'); e.style.display = e.style.display === 'none' ? 'block' : 'none'; };
  window.nameChanged = function () {
    var ok = !!($('clientName').value || '').trim();
    $('nameNext').classList.toggle('off', !ok);
    var who = ($('counselorName').value || '').trim();
    $('lastCounselor').textContent = who || '이름 없음';
    try { if (who) localStorage.setItem('ma_counselor', who); } catch (e) {}
  };
  window.nextFromName = function () {
    var client = ($('clientName').value || '').trim();
    if (!client) { $('clientName').focus(); return; }
    var who = ($('counselorName').value || '').trim() || '-', c = linkCfg();
    $('checkWho').textContent = '상담자 ' + who + ' · ' + client + ' 님 · ' + ((c && c.place) || '장소 미설정') + (S.stype ? ' · ' + S.stype : '');
    openCheckin();
  };
  function getObs() { try { return JSON.parse(localStorage.getItem('ma_obs') || '[]'); } catch (e) { return []; } }
  function updateObsCount() {
    var n = getObs().length;
    var b = $('recBtn');
    b.style.display = n > 0 ? 'inline-block' : 'none';
    b.textContent = '상담기록 ' + n + '건 보기';
  }
  var L1 = ['전혀', '조금', '많이'], L2 = ['더 차분', '비슷', '더 격함'], L3 = ['더 안심', '비슷', '더 불편'];
  function lbl(arr, v) { return (v === 0 || v === 1 || v === 2) ? arr[v] : '-'; }
  function fmtDate(d) {
    var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(d || '');
    return m ? (parseInt(m[1],10) + '월 ' + parseInt(m[2],10) + '일 ' + m[3]) : (d || '-');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function recLine(r) {
    return fmtDate(r.d) + ' · 상담자 ' + (r.c1 || '-') + ' · 내담자 ' + (r.c2 || '-') + ' · ' + r.min + '분 · 위험 신호 ' + r.alerts + '건'
      + ' | 유형: ' + (r.one || '(미선택)')
      + ' | 마음: ' + lbl(L3, r.a && r.a.q3)
      + ((r.a && (r.a.q1 != null || r.a.q2 != null)) ? ' (화면 의식: ' + lbl(L1, r.a.q1) + ' · 분위기: ' + lbl(L2, r.a.q2) + ')' : '')
      + (r.del ? ' | 원문 삭제됨(' + fmtDate(r.del.when) + ', 사유: ' + r.del.why + ')' : '');
  }
  window.openRecords = function () {
    var list = $('recList'); list.innerHTML = '';
    var arr = getObs();
    if (arr.length === 0) {
      list.innerHTML = '<div class="banner" style="max-width:none">아직 기록이 없어요 — 상담을 마치면 여기에 쌓여요</div>';
    } else {
      for (var i = arr.length - 1; i >= 0; i--) {
        (function (idx) {
          var r = arr[idx];
          var div = document.createElement('div');
          div.className = 'banner recrow';
          div.style.maxWidth = 'none';
          if (r.del) div.style.opacity = '0.75';
          div.innerHTML = '<b>' + esc(fmtDate(r.d)) + '</b> · ' + esc(r.c1 || '-') + ' → ' + esc(r.c2 || '-') + ' · ' + r.min + '분 · '
            + (r.alerts > 0 ? '<span style="color:#B3403A; font-weight:700">위험 신호 ' + r.alerts + '건</span>' : '위험 신호 0건')
            + '<br><span style="color:#55483A; font-weight:500">' + esc(r.one || '(유형 미선택)') + '</span>'
            + (r.del
              ? '<br><span style="color:#97302B; font-size:12.5px">원문 삭제됨 (' + esc(fmtDate(r.del.when)) + ') · 사유: ' + esc(r.del.why) + '</span>'
              : '<br><span style="color:#B3A28E; font-size:12.5px">누르면 전체 대화 보기 · 대화 ' + ((r.tr && r.tr.length) || 0) + '문장</span>');
          div.onclick = function () { openDetail(idx); };
          list.appendChild(div);
        })(i);
      }
    }
    $('copyBtn').textContent = '목록 복사하기';
    $('clearBtn').textContent = '전체 원문 삭제';
    $('clearWhy').style.display = 'none';
    $('clearWhy').value = '';
    clearArmed = false;
    go('records');
  };
  var curIdx = -1;
  window.openDetail = function (idx) {
    curIdx = idx;
    var r = getObs()[idx];
    if (!r) { openRecords(); return; }
    $('detTitle').textContent = fmtDate(r.d) + ' — ' + (r.c1 || '-') + ' → ' + (r.c2 || '-');
    $('detMeta').textContent = '상담 ' + r.min + '분 · 위험 신호 ' + r.alerts + '건 · 유형: ' + (r.one || '(미선택)');
    var list = $('detList'); list.innerHTML = '';
    if (r.del) {
      list.innerHTML = '<div style="color:#97302B; font-weight:700">대화 원문은 ' + esc(fmtDate(r.del.when)) + '에 삭제되었어요</div>'
        + '<div style="color:#55483A">삭제 사유: ' + esc(r.del.why) + '</div>'
        + '<div style="color:#8A7663; font-size:13px; margin-top:6px">날짜·이름·시간·위험 신호·한 줄 요약은 기록으로 남아 있어요.</div>';
    } else if (!r.tr || r.tr.length === 0) {
      list.innerHTML = '<div style="color:#8A7663">저장된 대화 기록이 없어요 — 음성 인식이 꺼져 있었거나 이전 버전의 기록이에요</div>';
    } else {
      list.innerHTML = '<div style="color:#B3A28E; font-size:12.5px">화자 구분 없이, 인식된 순서대로 기록돼요</div>';
      r.tr.forEach(function (l) {
        var div = document.createElement('div');
        div.innerHTML = '<span class="mono" style="color:#C05A2A; font-size:12.5px; margin-right:8px">' + esc(l.t) + '</span>' + esc(l.x);
        list.appendChild(div);
      });
    }
    $('dCopy1').textContent = '일지 초안 복사';
    $('dCopy2').textContent = 'AI 요약용 복사';
    $('dCopy2').style.display = (r.del || !r.tr || r.tr.length === 0) ? 'none' : 'inline-block';
    $('delBtn').style.display = r.del ? 'none' : 'inline-block';
    $('delWhy').style.display = 'none';
    $('delWhy').value = '';
    $('delGo').style.display = 'none';
    go('recdetail');
  };
  function curRecObj() { var a = getObs(); return (curIdx >= 0 && a[curIdx]) ? a[curIdx] : null; }
  window.askDelete = function () {
    $('delWhy').style.display = 'inline-block';
    $('delGo').style.display = 'inline-block';
    $('delWhy').focus();
  };
  window.doDelete = function () {
    var why = ($('delWhy').value || '').trim();
    if (!why) { $('delWhy').placeholder = '사유를 적어야 삭제할 수 있어요'; $('delWhy').focus(); return; }
    try {
      var arr = getObs();
      if (arr[curIdx] && !arr[curIdx].del) {
        arr[curIdx].del = { when: new Date().toISOString().slice(0, 16), why: why };
        arr[curIdx].tr = [];
        localStorage.setItem('ma_obs', JSON.stringify(arr));
      }
    } catch (e) {}
    openDetail(curIdx);
  };
  function trText(r) {
    return (r.tr || []).map(function (l) { return '[' + l.t + '] ' + l.x; }).join('\n');
  }
  window.copyJournal = function () {
    var r = curRecObj();
    if (!r) return;
    var txt = '[상담일지 초안]\n일시: ' + fmtDate(r.d) + '\n상담자: ' + (r.c1 || '-') + ' / 내담자: ' + (r.c2 || '-')
      + '\n상담 시간: ' + r.min + '분 / 위험 신호: ' + r.alerts + '건'
      + '\n상담 유형: ' + (r.one || '(미선택)');
    if (r.del) txt += '\n※ 대화 원문 ' + fmtDate(r.del.when) + ' 삭제됨 · 사유: ' + r.del.why;
    else txt += '\n\n--- 대화 기록 ---\n' + (trText(r) || '(없음)');
    doCopy(txt, 'dCopy1');
  };
  window.copyForAI = function () {
    var r = curRecObj();
    if (!r) return;
    var txt = '다음은 사회복지 상담 대화 기록입니다. 상담일지용으로 서술식 요약을 만들어 주세요.\n'
      + '- 내방 경위 / 상담 내용 / 조치 사항 / 향후 계획 순서로 정리\n'
      + '- 사실만 담고, 상담사의 주관적 감정 표현은 제외\n'
      + '- 개인을 특정할 수 있는 정보는 이니셜 처리\n\n'
      + '일시: ' + fmtDate(r.d) + ' / 상담 ' + r.min + '분 / 위험 신호 ' + r.alerts + '건\n'
      + '상담 유형: ' + (r.one || '(미선택)') + '\n\n대화 기록:\n' + (trText(r) || '(없음)');
    doCopy(txt, 'dCopy2');
  };
  function doCopy(txt, btnId) {
    function done() { $(btnId).textContent = '복사됐어요 ✓'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () { fallbackCopy(txt); done(); });
    } else { fallbackCopy(txt); done(); }
  }
  window.copyRecords = function () {
    var txt = '[마음안심 상담기록]\n' + getObs().map(recLine).join('\n');
    function done() { $('copyBtn').textContent = '복사됐어요 ✓'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () { fallbackCopy(txt); done(); });
    } else { fallbackCopy(txt); done(); }
  };
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  var clearArmed = false;
  window.clearRecords = function () {
    if (!clearArmed) {
      clearArmed = true;
      $('clearWhy').style.display = 'inline-block';
      $('clearWhy').focus();
      $('clearBtn').textContent = '사유 입력 후 한 번 더';
      return;
    }
    var why = ($('clearWhy').value || '').trim();
    if (!why) { $('clearWhy').placeholder = '사유를 적어야 삭제할 수 있어요'; $('clearWhy').focus(); return; }
    try {
      var arr = getObs();
      var when = new Date().toISOString().slice(0, 16);
      arr.forEach(function (r) { if (!r.del) { r.del = { when: when, why: why }; r.tr = []; } });
      localStorage.setItem('ma_obs', JSON.stringify(arr));
    } catch (e) {}
    updateObsCount();
    openRecords();
  };
  // ---------- 동료 연결 (무료 릴레이 ntfy.sh — 신호만, 대화 내용 없음) ----------
  var esSig = null, buddyEs = null, bRingId = 0, linkRole = '', hbId = 0, ringingOn = false, liveAt = 0, pruneId = 0;
  var sessions = {}, alertsMap = {};
  function linkCfg() { try { return JSON.parse(localStorage.getItem('ma_link') || 'null'); } catch (e) { return null; } }
  function topic() { var c = linkCfg(); return (c && c.code) ? 'https://ntfy.sh/maeum-anshim-' + c.code : null; }
  // 보내기 결과를 돌려준다(true = 서버가 받음). 상대가 받았다는 뜻은 아니다.
  function postSig(o) {
    var t = topic(); if (!t) return Promise.resolve(false);
    try {
      return fetch(t, { method: 'POST', body: JSON.stringify(o) }).then(function (r) { return !!(r && r.ok); }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function newId() { return Math.random().toString(36).slice(2, 8); }
  function hhmm(ts) { return new Date(ts || Date.now()).toTimeString().slice(0, 5); }
  function openES(h) {
    var t = topic(); if (!t) return null;
    var es = new EventSource(t + '/sse');
    es.onmessage = function (ev) {
      try {
        var d = JSON.parse(ev.data);
        if (!d.message) return;
        h(JSON.parse(d.message));
      } catch (e) {}
    };
    return es;
  }
  window.pickRole = function (el) {
    el.parentElement.querySelectorAll('.pill').forEach(function (p) { p.classList.remove('on'); });
    el.classList.add('on');
    linkRole = el.getAttribute('data-role');
    $('placeName').style.display = linkRole === 'host' ? 'inline-block' : 'none';
  };
  window.genCode = function () {
    var s = '', a = 'abcdefghjkmnpqrstuvwxyz23456789';
    for (var i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
    $('teamCode').value = s;
  };
  window.saveLink = function () {
    var code = ($('teamCode').value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!linkRole) { $('linkMsg').textContent = '이 기기의 역할을 먼저 골라주세요'; return; }
    if (code.length < 4) { $('linkMsg').textContent = '팀 코드를 입력하거나 새로 만들어주세요'; return; }
    var cfg = { code: code, role: linkRole, place: ($('placeName').value || '').trim() || '상담실' };
    try { localStorage.setItem('ma_link', JSON.stringify(cfg)); } catch (e) {}
    hostUnsubscribe();
    updateLinkStat();
    if (linkRole === 'board') { startBuddy(); }
    else if (linkRole === 'phone') { $('phoneName').value = phoneName(); $('pnameMsg').textContent = '폰을 다른 사람에게 건네면 이름만 바꾸면 돼요'; $('pnameMsg').style.color = ''; go('pname'); }
    else { $('linkMsg').textContent = '저장됐어요 — 상담 시작 화면에서 대기 중인 업무폰을 고를 수 있어요'; }
  };
  window.openLink = function () {
    var c = linkCfg();
    if (c) {
      $('teamCode').value = c.code || '';
      $('placeName').value = c.place || '';
      linkRole = c.role || '';
      document.querySelectorAll('#s-link .pill').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-role') === linkRole); });
    }
    $('placeName').style.display = (!c || linkRole === 'host') ? 'inline-block' : 'none';
    go('link');
  };
  window.linkTap = function () {
    var c = linkCfg();
    if (c && c.role === 'board') startBuddy();
    else if (c && c.role === 'phone') startPhone();
    else openLink();
  };
  function updateLinkStat() {
    var c = linkCfg(), el = $('linkStat'), b = $('linkBtn'), e2 = $('linkEdit');
    if (c && c.role === 'buddy') { c.role = 'board'; try { localStorage.setItem('ma_link', JSON.stringify(c)); } catch (e) {} }
    e2.style.display = (c && c.role !== 'host') ? 'inline-block' : 'none';
    if (!c) { el.textContent = ''; b.textContent = '동료 연결 설정'; return; }
    if (c.role === 'board') { el.textContent = '팀 상황판 · 팀 코드 ' + c.code; b.textContent = '상황판 대기 시작'; }
    else if (c.role === 'phone') { var n = phoneName(); el.textContent = '업무폰 · ' + (n || '이름 미등록') + ' · 팀 코드 ' + c.code; b.textContent = n ? '업무폰 대기 시작' : '업무폰 이름 등록'; }
    else { el.textContent = '상담용 태블릿 · ' + c.place + ' · 팀 코드 ' + c.code; b.textContent = '동료 연결 설정'; }
  }

  // ---------- 상담용 태블릿: 동료 찾기 · 연결 요청 · 수락 게이트 ----------
  var buddies = {}, reqTimer = 0, waitTick = 0;
  window.openCheckin = function () {
    var c = linkCfg();
    S.acc = null; S.rid = '';
    go('checkin');
    if (!(c && c.role === 'host')) {
      $('buddyPills').innerHTML = '';
      $('buddyNote').innerHTML = '동료 연결 설정이 아직 없어요 — <a href="#" onclick="openLink();return false" style="color:#C05A2A; font-weight:700">동료 연결 설정</a>에서 이 기기를 상담용 태블릿으로 저장해 주세요';
      updateReqBtn();
      return;
    }
    hostSubscribe();
    findBuddies();
  };
  function findBuddies() {
    $('buddyNote').textContent = '대기 중인 업무폰을 찾는 중…';
    renderBuddies(true);
    postSig({ type: 'ping', place: (linkCfg() || {}).place || '' }).then(function (ok) {
      if (!ok && S.screen === 'checkin') { $('buddyNote').textContent = '신호를 보내지 못했어요 — 인터넷 연결을 확인하고 "다시 찾기"를 눌러 주세요'; }
    });
    setTimeout(function () { if (S.screen === 'checkin') renderBuddies(false); }, 2500);
  }
  function renderBuddies(searching) {
    var box = $('buddyPills'); box.innerHTML = '';
    var now = Date.now(), names = Object.keys(buddies).filter(function (n) { return now - buddies[n] < 600000; });
    if (S.buddy && !S.buddyManual && names.indexOf(S.buddy) < 0) S.buddy = '';
    if (!S.buddy && !S.buddyManual && names.length === 1) S.buddy = names[0];
    names.forEach(function (n) {
      var on = !S.buddyManual && S.buddy === n;
      var p = document.createElement('span');
      p.className = 'pill' + (on ? ' on' : '');
      p.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:' + (on ? '#FFF9F3' : '#3E7A52') + '; margin-right:7px"></span>' + esc(n) + ' · 대기 중';
      p.onclick = function () { S.buddyManual = false; S.buddy = n; $('buddyManual').style.display = 'none'; renderBuddies(false); };
      box.appendChild(p);
    });
    var m = document.createElement('span');
    m.className = 'pill' + (S.buddyManual ? ' on' : ''); m.textContent = '직접 입력';
    m.onclick = function () { S.buddyManual = true; $('buddyManual').style.display = 'inline-block'; $('buddyManual').focus(); renderBuddies(false); };
    box.appendChild(m);
    var r = document.createElement('span');
    r.className = 'pill'; r.textContent = '다시 찾기'; r.style.color = '#8A7663';
    r.onclick = findBuddies;
    box.appendChild(r);
    if (!searching) {
      $('buddyNote').textContent = names.length
        ? '사무실에 남는 한 사람에게 직접 건네주세요. 이 사람에게만 요청이 가요.'
        : '대기 중인 업무폰이 없어요 — 업무폰에서 이름을 저장하면 여기에 나타나요';
    }
    updateReqBtn();
  }
  function chosenBuddy() { return S.buddyManual ? ($('buddyManual').value || '').trim() : (S.buddy || ''); }
  window.buddyChanged = function () { updateReqBtn(); };
  function updateReqBtn() {
    var b = $('reqBtn'), n = chosenBuddy(), c = linkCfg();
    b.textContent = n ? n + ' 선생님에게 연결 요청' : '연결 요청';
    b.classList.toggle('off', !(n && c && c.role === 'host'));
  }
  window.sendRequest = function () {
    var c = linkCfg(), name = chosenBuddy();
    if (!(c && c.role === 'host') || !name) { updateReqBtn(); return; }
    S.counselor = ($('counselorName').value || '').trim() || '-';
    S.client = ($('clientName').value || '').trim() || '-';
    try { localStorage.setItem('ma_counselor', S.counselor); } catch (e) {}
    S.rid = newId(); S.acc = null; S.reqTo = name; S.reqAt = Date.now();
    var rid = S.rid;
    hostSubscribe();
    setWait('sending');
    go('wait');
    postSig({ type: 'request', rid: rid, to: name, who: S.counselor, client: S.client, place: c.place || '상담실', ts: S.reqAt }).then(function (ok) {
      if (S.screen !== 'wait' || S.rid !== rid) return;
      if (!ok) { setWait('fail'); return; }
      setWait('waiting');
      clearTimeout(reqTimer);
      reqTimer = setTimeout(function () { if (S.screen === 'wait' && S.rid === rid && !S.acc) setWait('noanswer'); }, 60000);
    });
  };
  function setWait(st) {
    var name = S.reqTo || '동료';
    function show(id, on) { $(id).style.display = on ? 'inline-block' : 'none'; }
    clearInterval(waitTick);
    var pending = (st === 'sending' || st === 'waiting');
    show('waitOff', pending);
    show('waitCancel', pending || st === 'fail');
    show('waitPick', !pending);
    show('waitRetry', !pending);
    $('waitCard').style.display = pending ? 'block' : 'none';
    if (st === 'sending') { $('waitTitle').textContent = name + ' 선생님에게 요청을 보내는 중…'; $('waitSub').textContent = ''; }
    else if (st === 'waiting') {
      $('waitTitle').textContent = name + ' 선생님의 수락을 기다리는 중…';
      var upd = function () { $('waitSub').textContent = hhmm(S.reqAt) + ' 요청 보냄 · 경과 ' + fmt(Math.floor((Date.now() - S.reqAt) / 1000)); };
      upd(); waitTick = setInterval(upd, 1000);
    }
    else if (st === 'fail') { $('waitTitle').textContent = '연결 요청을 보내지 못했어요'; $('waitSub').textContent = '인터넷 연결을 확인하고 다시 시도해 주세요'; $('waitRetry').textContent = '다시 시도'; }
    else if (st === 'declined') { $('waitTitle').textContent = name + ' 선생님이 지금 받을 수 없다고 했어요'; $('waitSub').textContent = '업무폰을 다른 동료에게 건네고 다시 요청해 주세요 · 순서는 사무실 규칙대로'; $('waitRetry').textContent = '같은 사람에게 다시 요청'; }
    else if (st === 'noanswer') { $('waitTitle').textContent = '응답이 없어요'; $('waitSub').textContent = '업무폰이 켜져 있고 대기 화면인지 확인해 주세요'; $('waitRetry').textContent = '같은 사람에게 다시 요청'; }
  }
  window.withdrawReq = function () {
    clearTimeout(reqTimer); clearInterval(waitTick);
    if (S.rid) postSig({ type: 'withdraw', rid: S.rid });
    S.rid = ''; S.acc = null;
    go('checkin');
    renderBuddies(false);
  };
  function onAccepted(m) {
    if (!S.rid || m.rid !== S.rid || S.screen !== 'wait') return;
    clearTimeout(reqTimer); clearInterval(waitTick);
    S.acc = { name: m.by || S.reqTo, rid: S.rid, at: Date.now() };
    go('notice');
  }
  function releaseLink() {
    if (S.acc) postSig({ type: 'withdraw', rid: S.acc.rid });
    S.acc = null; S.rid = '';
  }
  window.backFromNotice = function () { releaseLink(); go('checkin'); renderBuddies(false); };
  window.abandonSession = function () { releaseLink(); go('start'); };

  // ---------- 업무폰: 이름 등록 · 대기 · 수락 · 연결 ----------
  var phoneEs = null, pTick = 0, pRingId = 0, pendId = 0, P = { name: '', req: null, conn: null, alerts: 0 };
  function phoneName() { try { return localStorage.getItem('ma_phone_name') || ''; } catch (e) { return ''; } }
  window.savePhoneName = function () {
    var n = ($('phoneName').value || '').trim();
    if (!n) { $('pnameMsg').textContent = '이름을 적어야 대기를 시작할 수 있어요'; $('pnameMsg').style.color = '#B3403A'; return; }
    try { localStorage.setItem('ma_phone_name', n); } catch (e) {}
    updateLinkStat();
    startPhone();
  };
  window.startPhone = function () {
    var c = linkCfg(); if (!(c && c.role === 'phone')) { openLink(); return; }
    var n = phoneName(); if (!n) { $('phoneName').value = ''; go('pname'); return; }
    P.name = n; P.req = null; P.conn = null; P.alerts = 0;
    clearTimeout(pendId); phoneRing(false); clearInterval(pTick);
    $('pwaitName').textContent = n; $('pwaitCode').textContent = '팀 코드 ' + c.code;
    $('pwaitMsg').textContent = '';
    go('pwait');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try { audioCtx.resume(); } catch (e) {}
    if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
    if (!phoneEs || phoneEs.readyState === 2) {
      if (phoneEs) { try { phoneEs.close(); } catch (e) {} }
      phoneEs = openES(onPhoneMsg);
    }
    sayReady();
  };
  function sayReady() {
    postSig({ type: 'ready', name: P.name, ts: Date.now() }).then(function (ok) {
      if (S.screen !== 'pwait') return;
      if (!ok) { $('pwaitMsg').textContent = '신호를 보내지 못했어요 — 인터넷 연결을 확인해 주세요'; return; }
      if (!$('pwaitMsg').textContent) $('pwaitMsg').textContent = '상담자 화면에 "' + P.name + '" 이름이 보여요 (' + hhmm() + ')';
    });
  }
  window.stopPhone = function () {
    if (phoneEs) { try { phoneEs.close(); } catch (e) {} phoneEs = null; }
    phoneRing(false); clearInterval(pTick); clearTimeout(pendId);
    P.req = null; P.conn = null;
    go('start');
  };
  function onPhoneMsg(m) {
    if (m.type === 'ping') { if (S.screen === 'pwait') sayReady(); return; }
    if (m.type === 'request') {
      if (m.to !== P.name) return;
      if (m.ts && Date.now() - m.ts > 90000) return;
      if (P.conn) return;
      P.req = m;
      $('preqWho').textContent = m.who || '-';
      $('preqTime').textContent = hhmm(m.ts);
      $('preqInfo').innerHTML = '<b>내담자</b> ' + esc(m.client || '-') + '<br><b>장소</b> ' + esc(m.place || '-') + '<br><b>요청 시각</b> ' + hhmm(m.ts);
      go('preq');
      phoneRing(true);
      notifyDesktop((m.who || '') + ' 선생님 · 연결 요청', (m.place || '') + ' · 눌러서 수락');
      return;
    }
    if (m.type === 'withdraw') {
      if (P.req && m.rid === P.req.rid) { P.req = null; startPhone(); $('pwaitMsg').textContent = '요청이 취소됐어요 (' + hhmm() + ')'; }
      else if (P.conn && m.rid === P.conn.rid) { endConn('상담이 시작되지 않고 취소됐어요'); }
      return;
    }
    if (!P.conn || m.rid !== P.conn.rid) return;
    if (m.type === 'start' || m.type === 'hb') { if (m.at) P.conn.at = m.at; P.conn.started = true; $('pconnState').textContent = '연결됨 · 상담 중'; }
    else if (m.type === 'alert') {
      if (m.ts && Date.now() - m.ts > 600000) return;
      P.alerts += 1;
      var a = $('pAlert');
      a.style.display = 'block';
      a.innerHTML = '<b style="font-size:16px">위험 신호 — ' + esc(m.place || '상담실') + '</b><br>' + esc(m.who || '') + ' 선생님 · 상담 ' + esc(m.t || '-') + ' 경과<br><span style="font-size:12px; color:#F0C4BF">전화 걸기 → 노크 → 동석 순으로, 부담 적은 개입부터</span>';
      var b = document.createElement('button');
      b.className = 'mid'; b.textContent = '확인했어요 — 지금 볼게요';
      b.style.cssText = 'margin-top:10px; background:#FFF6F4; border-color:#FFF6F4; color:#97302B; display:block';
      b.onclick = function () { postSig({ type: 'ack', rid: P.conn ? P.conn.rid : '', place: m.place, by: P.name }); a.style.display = 'none'; phoneRing(false); };
      a.appendChild(b);
      phoneRing(true);
      notifyDesktop('위험 신호 — ' + (m.place || '상담실'), (m.who || '') + ' 선생님 · 상담 ' + (m.t || '') + ' 경과');
      if (navigator.vibrate) navigator.vibrate([400, 150, 400]);
    }
    else if (m.type === 'cancel') { $('pAlert').style.display = 'none'; phoneRing(false); }
    else if (m.type === 'end') { endConn(''); }
  }
  window.acceptReq = function () {
    var r = P.req; if (!r) { startPhone(); return; }
    phoneRing(false);
    P.req = null; P.alerts = 0;
    P.conn = { rid: r.rid, who: r.who, client: r.client, place: r.place, at: Date.now(), started: false };
    $('pconnWho').textContent = r.who || '-';
    $('pconnState').textContent = '수락함 · 상담 시작 기다리는 중';
    $('pconnInfo').innerHTML = '<b>내담자</b> ' + esc(r.client || '-') + '<br><b>장소</b> ' + esc(r.place || '-') + '<br><b>수락</b> ' + hhmm();
    $('pAlert').style.display = 'none';
    $('pTimer').textContent = '00:00';
    go('pconn');
    clearInterval(pTick);
    pTick = setInterval(function () { if (P.conn) $('pTimer').textContent = fmt(Math.max(0, Math.floor((Date.now() - P.conn.at) / 1000))); }, 1000);
    postSig({ type: 'accept', rid: r.rid, by: P.name, place: r.place, ts: Date.now() }).then(function (ok) {
      if (!ok && P.conn && P.conn.rid === r.rid) $('pconnState').textContent = '수락 신호를 보내지 못했어요 — 인터넷 확인';
    });
  };
  window.declineReq = function () {
    var r = P.req; P.req = null; phoneRing(false);
    if (r) postSig({ type: 'decline', rid: r.rid, by: P.name, place: r.place });
    startPhone();
    $('pwaitMsg').textContent = '지금 받을 수 없다고 알렸어요 (' + hhmm() + ')';
  };
  function endConn(note) {
    var c = P.conn; P.conn = null; phoneRing(false); clearInterval(pTick);
    if (!c) return;
    var mins = Math.max(0, Math.round((Date.now() - c.at) / 60000));
    $('pendWho').textContent = c.who || '-';
    $('pendSum').textContent = note || ('총 ' + mins + '분 · 위험 신호 ' + P.alerts + '건');
    go('pend');
    clearTimeout(pendId);
    pendId = setTimeout(function () { if (S.screen === 'pend') startPhone(); }, 8000);
  }
  function phoneRing(on) {
    clearInterval(pRingId);
    if (!on) return;
    function b() {
      if (S.screen !== 'preq' && S.screen !== 'pconn') { clearInterval(pRingId); return; }
      beep();
      if (navigator.vibrate) navigator.vibrate(200);
    }
    b();
    pRingId = setInterval(b, 1400);
  }
  function skey(m) { return (m.place || '?') + '|' + (m.who || '?'); }
  function renderBoard() {
    var bl = $('boardList'), ac = $('alertCards');
    bl.innerHTML = ''; ac.innerHTML = '';
    var ak = Object.keys(alertsMap), sk = Object.keys(sessions);
    ak.forEach(function (k) {
      var a = alertsMap[k];
      var d = document.createElement('div');
      d.className = 'banner';
      d.style.cssText = 'max-width:none; background:#B3403A; border-color:#B3403A; color:#FFF6F4';
      d.innerHTML = '<b style="font-size:16px">위험 신호 — ' + esc(a.place) + '</b><br>' + esc(a.who) + ' 선생님 · 상담 ' + esc(a.t || '-') + ' 경과<br><span style="font-size:12px; color:#F0C4BF">전화 걸기 → 노크 → 동석 순으로, 부담 적은 개입부터</span>';
      var b = document.createElement('button');
      b.className = 'mid';
      b.textContent = '확인했어요 — 지금 볼게요';
      b.style.cssText = 'margin-top:10px; background:#FFF6F4; border-color:#FFF6F4; color:#97302B; display:block';
      b.onclick = function () { postSig({ type: 'ack', place: a.place }); delete alertsMap[k]; renderBoard(); };
      d.appendChild(b);
      ac.appendChild(d);
    });
    sk.forEach(function (k) {
      var s2 = sessions[k];
      var mins = Math.max(0, Math.round((Date.now() - (s2.at || Date.now())) / 60000));
      var danger = !!alertsMap[k];
      var d = document.createElement('div');
      d.className = 'banner';
      d.style.maxWidth = 'none';
      d.innerHTML = '<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:' + (danger ? '#B3403A' : '#3E7A52') + '; margin-right:10px"></span><b>' + esc(s2.place) + '</b> · ' + esc(s2.who) + ' 선생님 · 진행 ' + mins + '분' + (danger ? ' · <span style="color:#B3403A; font-weight:700">위험 신호!</span>' : '');
      bl.appendChild(d);
    });
    $('boardEmpty').style.display = (sk.length === 0 && ak.length === 0) ? 'block' : 'none';
    buddyRing(ak.length > 0);
    document.title = ak.length > 0 ? '🔴 위험 신호! — 마음안심' : '마음안심';
  }
  function notifyDesktop(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') new Notification(title, { body: body, requireInteraction: true, tag: 'ma-alert' });
    } catch (e) {}
  }
  function beep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
      var ac = audioCtx, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = 740;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.28, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.55);
    } catch (e) {}
  }
  function updateNotifStat() {
    var el = $('notifStat');
    if (!el) return;
    if (!('Notification' in window)) { el.textContent = '이 브라우저는 바탕화면 알림 미지원 (소리는 동작)'; return; }
    if (Notification.permission === 'granted') { el.textContent = '바탕화면 알림: 허용됨 ✓'; el.style.color = '#3E7A52'; }
    else if (Notification.permission === 'denied') { el.textContent = '알림 차단됨 — 주소창 자물쇠 아이콘 → 알림 → 허용으로 바꿔주세요'; el.style.color = '#B3403A'; }
    else { el.textContent = '알림 미설정 — 왼쪽 테스트 버튼을 눌러 허용해 주세요'; el.style.color = '#B07A1E'; }
  }
  window.testAlarm = function (btn) {
    beep();
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          notifyDesktop('테스트 알림 — 마음안심', '소리와 이 알림이 확인되면 준비 완료예요!');
        } else if (Notification.permission === 'default') {
          Notification.requestPermission().then(function (p) {
            updateNotifStat();
            if (p === 'granted') notifyDesktop('테스트 알림 — 마음안심', '소리와 이 알림이 확인되면 준비 완료예요!');
          });
        }
      }
    } catch (e) {}
    updateNotifStat();
    if (btn) { btn.textContent = '테스트 실행됨 ✓'; setTimeout(function () { btn.textContent = '소리·알림 테스트'; }, 2500); }
  };
  function startBuddy() {
    var c = linkCfg(); if (!c) return;
    $('buddyCode').textContent = '팀 코드 ' + c.code;
    sessions = {}; alertsMap = {};
    go('buddy');
    renderBoard();
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try { audioCtx.resume(); } catch (e) {}
    if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(updateNotifStat); } catch (e) {}
    updateNotifStat();
    if (buddyEs) { try { buddyEs.close(); } catch (e) {} }
    liveAt = Date.now() + 3000;
    var t = topic(); if (!t) return;
    buddyEs = new EventSource(t + '/sse?since=6h');
    buddyEs.onmessage = function (ev) {
      var m;
      try {
        var d = JSON.parse(ev.data);
        if (!d.message) return;
        m = JSON.parse(d.message);
      } catch (e) { return; }
      var k = skey(m);
      if (m.type === 'start' || m.type === 'hb') {
        sessions[k] = { place: m.place || '상담실', who: m.who || '-', at: m.at || Date.now(), last: Date.now() };
        renderBoard();
      } else if (m.type === 'end') {
        delete sessions[k]; delete alertsMap[k];
        renderBoard();
      } else if (m.type === 'alert') {
        if (m.ts && Date.now() - m.ts > 600000) return;
        alertsMap[k] = { place: m.place || '상담실', who: m.who || '-', t: m.t || '' };
        if (!sessions[k]) sessions[k] = { place: m.place || '상담실', who: m.who || '-', at: Date.now(), last: Date.now() };
        renderBoard();
        if (Date.now() > liveAt) {
          beep();
          notifyDesktop('위험 신호 — ' + (m.place || '상담실'), (m.who || '') + ' 선생님 · 상담 ' + (m.t || '') + ' 경과');
          if (navigator.vibrate) navigator.vibrate([400, 150, 400]);
        }
      } else if (m.type === 'cancel' || m.type === 'ack') {
        Object.keys(alertsMap).forEach(function (k2) { if (!m.place || alertsMap[k2].place === m.place) delete alertsMap[k2]; });
        renderBoard();
      }
    };
    clearInterval(pruneId);
    pruneId = setInterval(function () {
      var now = Date.now(), ch = false;
      Object.keys(sessions).forEach(function (k) { if (now - sessions[k].last > 200000) { delete sessions[k]; ch = true; } });
      if (ch || Object.keys(sessions).length > 0) renderBoard();
    }, 30000);
  }
  function buddyRing(on) {
    if (on === ringingOn) return;
    ringingOn = on;
    clearInterval(bRingId);
    if (!on) return;
    function b() {
      if (S.screen !== 'buddy' || !ringingOn) return;
      beep();
    }
    b();
    bRingId = setInterval(b, 1400);
  }
  window.stopBuddy = function () {
    if (buddyEs) { try { buddyEs.close(); } catch (e) {} buddyEs = null; }
    clearInterval(pruneId);
    buddyRing(false);
    document.title = '마음안심';
    go('start');
  };
  function hostSubscribe() {
    var c = linkCfg();
    if (!(c && c.role === 'host')) return;
    if (esSig && esSig.readyState !== 2) return;
    if (esSig) { try { esSig.close(); } catch (e) {} }
    esSig = openES(function (m) {
      if (m.type === 'ready' && m.name) { buddies[m.name] = Date.now(); if (S.screen === 'checkin') renderBuddies(false); }
      else if (m.type === 'accept') onAccepted(m);
      else if (m.type === 'decline') { if (S.rid && m.rid === S.rid && S.screen === 'wait') { clearTimeout(reqTimer); setWait('declined'); } }
      else if (m.type === 'ack') {
        if (S.acc && m.rid && m.rid !== S.acc.rid) return;
        var el = $('ackLine');
        if (el) el.textContent = '✓ ' + (m.by ? m.by + ' 선생님이' : '동료가') + ' 확인했어요 — 오고 있어요 (' + hhmm() + ')';
      }
    });
  }
  function hostUnsubscribe() { if (esSig) { try { esSig.close(); } catch (e) {} esSig = null; } }

  applyCfg();
  updateObsCount();
  updateLinkStat();
  try { $('counselorName').value = localStorage.getItem('ma_counselor') || ''; } catch (e) {}
  window.__checkThreat = checkThreat;
  window.__hostSub = hostSubscribe; window.__hostUnsub = hostUnsubscribe;
  window.addEventListener('resize', sizeCanvas);
})();

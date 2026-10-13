// Saga HQ · quick capture page. Lives on the home screen; sends text straight to the user's own
// Apps Script inbox (URL and key come in the link's #fragment, which never reaches any server).
(function () {
  var LS = 'saga-quick';
  var QUEUE = 'saga-quick-queue';
  var $ = function (id) { return document.getElementById(id); };
  var text = $('text');
  var status = $('status');
  var send = $('send');

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  var params = new URLSearchParams(location.hash.slice(1));
  var cfg = params.get('u') && params.get('k') ? { u: params.get('u'), k: params.get('k') } : read(LS);
  if (params.get('u') && params.get('k')) write(LS, cfg);
  if (!cfg || !/^https:\/\/script\.google\.com\//.test(cfg.u)) {
    $('sub').textContent = 'Abre este enlace desde Saga HQ › Ajustes › Captura por voz.';
    send.disabled = true;
  }

  function say(msg, kind) {
    status.textContent = msg;
    status.className = 'q-status ' + (kind || '');
  }

  function post(t, source) {
    return fetch(cfg.u, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: cfg.k, text: t, source: source || 'pantalla-inicio' }),
    })
      .then(function (r) { return r.text(); })
      .then(function (body) {
        var j;
        try { j = JSON.parse(body); } catch (e) { throw new Error('respuesta'); }
        if (!j.ok) throw new Error(j.error === 'clave' ? 'clave' : 'respuesta');
        return true;
      });
  }

  function flush() {
    var q = read(QUEUE) || [];
    if (!q.length || !cfg) return;
    var next = q[0];
    post(next).then(function () {
      write(QUEUE, q.slice(1));
      say('Enviadas las ideas pendientes ✨', 'ok');
      flush();
    }).catch(function () { /* retry later */ });
  }

  document.querySelectorAll('[data-prefix]').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = b.getAttribute('data-prefix');
      var v = text.value.replace(/^(Idea|Tarea|Guion para|Radar|Pieza)\b[:\s]*/i, '');
      text.value = p + v;
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    });
  });

  $('paste').addEventListener('click', function () {
    if (!navigator.clipboard || !navigator.clipboard.readText) return say('Mantén pulsado el cuadro y elige Pegar.');
    navigator.clipboard.readText().then(function (v) {
      if (v) text.value = text.value ? text.value + '\n' + v : v;
      text.focus();
    }).catch(function () { say('Mantén pulsado el cuadro y elige Pegar.'); });
  });

  function save(source) {
    var t = text.value.trim();
    if (!t) { text.focus(); return say('Escribe o dicta algo primero.'); }
    send.disabled = true;
    say('Guardando…');
    post(t, source).then(function () {
      text.value = '';
      say('Guardado en Saga ✨ Lo verás en Hoy › Llegadas.', 'ok');
    }).catch(function (e) {
      if (e && e.message === 'clave') say('La clave no coincide: vuelve a abrir el enlace desde Saga HQ.', 'bad');
      else {
        var q = read(QUEUE) || [];
        q.push(t);
        write(QUEUE, q);
        text.value = '';
        say('Sin conexión: la guardo y la envío en cuanto vuelva la red.', 'bad');
      }
    }).finally(function () { send.disabled = false; });
  }
  send.addEventListener('click', function () { save(); });

  // Opened by the iOS Shortcut with the dictated text in #t=…: send it right away, then drop it
  // from the address so a reload never sends it twice.
  var incoming = params.get('t');
  if (incoming && cfg && !send.disabled) {
    params.delete('t');
    history.replaceState(null, '', location.pathname + location.search + '#' + params.toString());
    text.value = incoming;
    save('atajo');
  }

  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });
  flush();
})();

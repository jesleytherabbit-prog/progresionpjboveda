// ==UserScript==
// @name         Bóveda → Progresión de Personaje
// @namespace    hp-avada-kedavra.progresion
// @version      1.1
// @description  Lee la bóveda de grageas (todas sus páginas), suma los movimientos por mes y los pasa a la app Progresión de Personaje.
// @match        https://hp-avada-kedavra.foroactivo.com/t*
// @match        https://*.github.io/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jesleytherabbit-prog/progresionpjboveda/main/boveda-a-progresion.user.js
// @downloadURL  https://raw.githubusercontent.com/jesleytherabbit-prog/progresionpjboveda/main/boveda-a-progresion.user.js
// ==/UserScript==

(function () {
  "use strict";

  const LLAVE_ENVIO = "envio-boveda";
  const CLAVE_APP = "progresion-personaje-v1";
  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const MES_IDX = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 };
  const METRICAS = {
    ganadas: "Ganadas (suma de los «+»)",
    gastadas: "Gastadas (suma de los «−»)",
    totales: "Ganadas según «Grageas totales»"
  };

  const css = `
  .bvp-btn{position:fixed;right:18px;bottom:18px;z-index:99999;background:#F7D6E0;color:#5C4433;border:1.5px solid #B08968;
    border-radius:14px;padding:9px 14px;font:700 13px/1.2 Quicksand,"Century Gothic",system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(92,68,51,.18)}
  .bvp-btn:hover{background:#FCEFC7}
  .bvp-panel{position:fixed;right:18px;bottom:68px;z-index:99999;width:min(94vw,380px);max-height:calc(100vh - 90px);overflow:auto;background:#FAF3E7;color:#5C4433;
    border:1.5px solid #B08968;border-radius:14px;box-shadow:0 18px 44px rgba(92,68,51,.28);font:500 13px/1.4 Quicksand,"Century Gothic",system-ui,sans-serif}
  .bvp-panel *{box-sizing:border-box}
  .bvp-cab{background:#EFD9EB;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-radius:12px 12px 0 0;position:sticky;top:0}
  .bvp-cab b{letter-spacing:.06em;font-size:13px}
  .bvp-x{background:none;border:0;font-size:18px;color:#5C4433;cursor:pointer;line-height:1}
  .bvp-cuerpo{padding:12px;display:flex;flex-direction:column;gap:10px}
  .bvp-cuerpo label{display:flex;flex-direction:column;gap:3px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7A5C43}
  .bvp-cuerpo input,.bvp-cuerpo select{font:inherit;font-size:13px;text-transform:none;letter-spacing:0;color:#5C4433;background:#fff;border:1.5px solid #E6D7C3;border-radius:9px;padding:6px 8px}
  .bvp-fila{display:flex;gap:8px}.bvp-fila>*{flex:1}
  .bvp-tabla{width:100%;border-collapse:collapse;background:#FFFDF6;border:1px solid #E6D7C3;border-radius:10px;overflow:hidden}
  .bvp-tabla td{padding:4px 8px;border-bottom:1px solid #F1E6D6}
  .bvp-tabla td:last-child{text-align:right;font-family:"DM Mono",Consolas,monospace;color:#3F5B41}
  .bvp-tabla tr:last-child td{border-bottom:0;font-weight:700;background:#D9F0E4}
  .bvp-acc{display:flex;gap:8px;flex-wrap:wrap}
  .bvp-acc button{flex:1;font:700 12.5px Quicksand,system-ui,sans-serif;border:1.5px solid #E6D7C3;background:#fff;color:#5C4433;border-radius:10px;padding:8px 10px;cursor:pointer;white-space:nowrap}
  .bvp-acc button.bvp-pri{background:#C3E6D6;border-color:#9fcbb6}
  .bvp-acc button:hover{filter:brightness(.97)}
  .bvp-nota{font-size:11.5px;color:#7A5C43;font-style:italic;margin:0}
  .bvp-ok{color:#3F5B41;font-weight:700}
  .bvp-banner{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99999;width:min(94vw,560px);background:#FCEFC7;color:#5C4433;
    border:1.5px solid #B08968;border-radius:14px;padding:12px 14px;box-shadow:0 12px 30px rgba(92,68,51,.25);font:500 13.5px/1.4 Quicksand,system-ui,sans-serif;display:flex;flex-direction:column;gap:8px}
  .bvp-banner .bvp-acc button{flex:0 1 auto}
  `;
  function estilos() { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }
  function el(tag, attrs = {}, html = "") { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; }
  const fmt = n => Math.round(n).toLocaleString("es-AR");

  // =========================================================
  //  LADO FORO: leer la bóveda
  // =========================================================
  function esBoveda() {
    return location.hostname.includes("foroactivo.com") && !!document.querySelector(".scaja-content");
  }

  // "14,000" / "1.370" / "4000" -> número entero
  function aNumero(t) {
    if (t == null) return null;
    const m = String(t).match(/-?\d[\d.,]*/);
    if (!m) return null;
    return parseInt(m[0].replace(/[.,]/g, ""), 10);
  }

  // Lee "Grageas que se añaden/quitan" y devuelve {mas, menos}
  function leerMovimiento(texto, ini, act) {
    const t = (texto || "").trim();
    if (!t) return { mas: 0, menos: 0 };
    const quita = /quit|gast|rest|desc|pag|compr/i.test(t);
    const pone = /añad|sum|gan|ingres|recib/i.test(t);
    // ¿hay un total entre paréntesis? ej: "+30 +10 +25 + 15 (80)"
    const total = t.match(/\(\s*([+-]?\s*\d[\d.,]*)\s*\)/);
    let partes = [];
    if (total) partes = [total[1].replace(/\s+/g, "")];
    else partes = (t.replace(/\([^)]*\)/g, " ").match(/[+\-−–]?\s*\d[\d.,]*/g) || []).map(x => x.replace(/\s+/g, ""));
    let mas = 0, menos = 0;
    // signo por defecto para números sin + / -
    let defecto = quita ? -1 : pone ? 1 : (ini != null && act != null ? (act < ini ? -1 : 1) : 1);
    for (const p of partes) {
      const n = aNumero(p.replace(/^[+\-−–]/, ""));
      if (!n) continue;
      const signo = /^[\-−–]/.test(p) ? -1 : /^\+/.test(p) ? 1 : defecto;
      if (signo > 0) mas += n; else menos += n;
    }
    return { mas, menos };
  }

  function leerFecha(texto) {
    const t = (texto || "").toLowerCase();
    const hoy = new Date();
    if (/\bhoy\b/.test(t)) return { anio: hoy.getFullYear(), mes: hoy.getMonth() };
    if (/\bayer\b/.test(t)) { const a = new Date(hoy - 864e5); return { anio: a.getFullYear(), mes: a.getMonth() }; }
    const m = t.match(/(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-zé]*\.?\s+(\d{4})/);
    if (!m) return null;
    return { anio: +m[3], mes: MES_IDX[m[2]] };
  }

  function leerCaja(caja) {
    const campos = {};
    caja.querySelectorAll(".scaja-form").forEach(s => {
      let txt = "", n = s.nextSibling;
      while (n && !(n.nodeType === 1 && (n.tagName === "BR" || n.classList.contains("scaja-form")))) { txt += n.textContent; n = n.nextSibling; }
      const clave = s.textContent.replace(/[{}«»]/g, "").trim().toLowerCase();
      campos[clave] = txt.trim();
    });
    const busca = re => { const k = Object.keys(campos).find(k => re.test(k)); return k ? campos[k] : ""; };
    return {
      iniciales: aNumero(busca(/inicial/)),
      movimiento: busca(/añad|quit/),
      actuales: aNumero(busca(/actual/)),
      totales: aNumero(busca(/total/))
    };
  }

  function leerDocumento(doc, salida, vistos) {
    doc.querySelectorAll(".post").forEach(post => {
      const caja = post.querySelector(".scaja-content");
      if (!caja) return;
      const id = post.id || (post.className.match(/post--(\d+)/) || [])[1];
      if (id && vistos.has(id)) return;
      if (id) vistos.add(id);
      const autor = post.querySelector("p.author");
      const fecha = leerFecha(autor ? autor.textContent : "");
      if (!fecha) return;
      const nombre = autor && autor.querySelector("strong") ? autor.querySelector("strong").textContent.trim() : "";
      const c = leerCaja(caja);
      const mov = leerMovimiento(c.movimiento, c.iniciales, c.actuales);
      salida.push({ ...fecha, autor: nombre, ...c, ...mov });
    });
  }

  async function leerBoveda(progreso) {
    const m = location.pathname.match(/^\/t(\d+)(?:p\d+)?-(.*)$/);
    if (!m) throw new Error("No reconozco la URL del tema");
    const [, id, slug] = m;
    const inicios = new Set([0]);
    document.querySelectorAll(`a[href*="/t${id}p"]`).forEach(a => {
      const x = a.getAttribute("href").match(new RegExp(`/t${id}p(\\d+)-`));
      if (x) inicios.add(+x[1]);
    });
    // completar huecos de la paginación (ej: 0,15,…,90 si solo se ven algunas)
    const lista = [...inicios].sort((a, b) => a - b);
    const paso = lista.length > 1 ? lista[1] : 0;
    if (paso) for (let s = 0; s <= lista[lista.length - 1]; s += paso) inicios.add(s);
    const paginas = [...inicios].sort((a, b) => a - b);

    const movimientos = [], vistos = new Set();
    let dueno = "";
    for (let i = 0; i < paginas.length; i++) {
      progreso(`Leyendo página ${i + 1} de ${paginas.length}…`);
      const url = paginas[i] ? `/t${id}p${paginas[i]}-${slug}` : `/t${id}-${slug}`;
      const html = await (await fetch(url, { credentials: "same-origin" })).text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (i === 0) {
        const primero = doc.querySelector(".post p.author strong");
        dueno = primero ? primero.textContent.trim() : "";
      }
      leerDocumento(doc, movimientos, vistos);
    }
    return { dueno, movimientos, titulo: document.title };
  }

  // Devuelve 12 valores para un año y una métrica
  function resumir(movs, anio, metrica) {
    const meses = Array(12).fill(0);
    if (metrica === "totales") {
      let previo = null;
      const ultimo = Array(12).fill(null);
      for (const mv of movs) {
        if (mv.totales == null) continue;
        if (mv.anio < anio) previo = mv.totales;
        else if (mv.anio === anio) ultimo[mv.mes] = mv.totales;
      }
      for (let i = 0; i < 12; i++) {
        if (ultimo[i] == null) continue;
        meses[i] = previo == null ? 0 : Math.max(0, ultimo[i] - previo);
        previo = ultimo[i];
      }
      return meses;
    }
    for (const mv of movs) {
      if (mv.anio !== anio) continue;
      if (metrica === "ganadas") meses[mv.mes] += mv.mas;
      else if (metrica === "gastadas") meses[mv.mes] += mv.menos;
    }
    return meses;
  }

  function panelForo() {
    estilos();
    const btn = el("button", { className: "bvp-btn", type: "button", textContent: "✿ Pasar a Progresión" });
    document.body.appendChild(btn);
    let panel = null, datos = null;

    btn.addEventListener("click", async () => {
      if (panel) { panel.remove(); panel = null; return; }
      panel = el("div", { className: "bvp-panel" });
      panel.innerHTML = `<div class="bvp-cab"><b>✿ BÓVEDA → PROGRESIÓN</b><button class="bvp-x" title="Cerrar">×</button></div><div class="bvp-cuerpo"><p class="bvp-nota" id="bvp-estado">Leyendo la bóveda…</p></div>`;
      document.body.appendChild(panel);
      panel.querySelector(".bvp-x").onclick = () => { panel.remove(); panel = null; };
      const estado = t => { const e = panel && panel.querySelector("#bvp-estado"); if (e) e.textContent = t; };
      try {
        if (!datos) datos = await leerBoveda(estado);
        if (panel) armar();
      } catch (e) { estado("No pude leer la bóveda: " + e.message); }
    });

    function armar() {
      const cuerpo = panel.querySelector(".bvp-cuerpo");
      const anios = [...new Set(datos.movimientos.map(m => m.anio))].sort((a, b) => b - a);
      if (!anios.length) { cuerpo.innerHTML = `<p class="bvp-nota">No encontré movimientos en esta bóveda.</p>`; return; }
      cuerpo.innerHTML = `
        <label>Personaje<input id="bvp-nombre" maxlength="40"></label>
        <div class="bvp-fila">
          <label style="flex:0 0 90px">Año<select id="bvp-anio">${anios.map(a => `<option>${a}</option>`).join("")}</select></label>
          <label>Qué contar<select id="bvp-metrica">${Object.entries(METRICAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        </div>
        <p class="bvp-nota" id="bvp-ayuda"></p>
        <table class="bvp-tabla" id="bvp-tabla"></table>
        <div class="bvp-acc">
          <button class="bvp-pri" id="bvp-enviar">Enviar a la app</button>
          <button id="bvp-copiar" title="Para pegar en una fila de Excel">Copiar números</button>
        </div>
        <p class="bvp-nota" id="bvp-estado">${datos.movimientos.length} movimientos leídos.</p>`;
      const $ = s => cuerpo.querySelector(s);
      $("#bvp-nombre").value = datos.dueno;
      const valores = () => resumir(datos.movimientos, +$("#bvp-anio").value, $("#bvp-metrica").value);
      const AYUDA = {
        ganadas: "Suma lo que se añade en cada post de la bóveda.",
        gastadas: "Suma lo que se quita en cada post de la bóveda.",
        totales: "Usa cuánto sube «Grageas totales» cada mes: también cuenta ingresos que no se anotaron como movimiento (y los arreglos de los moderadores)."
      };
      const pintar = () => {
        const v = valores();
        $("#bvp-ayuda").textContent = AYUDA[$("#bvp-metrica").value];
        $("#bvp-tabla").innerHTML = MESES.map((m, i) => `<tr><td>${m}</td><td>${fmt(v[i])}</td></tr>`).join("") +
          `<tr><td>Total</td><td>${fmt(v.reduce((a, b) => a + b, 0))}</td></tr>`;
      };
      $("#bvp-anio").onchange = pintar;
      $("#bvp-metrica").onchange = pintar;
      pintar();

      $("#bvp-copiar").onclick = () => {
        const txt = valores().join("\t");
        try { GM_setClipboard(txt, "text"); } catch (_) { navigator.clipboard && navigator.clipboard.writeText(txt); }
        $("#bvp-estado").innerHTML = `<span class="bvp-ok">Copiado ✓</span> Pegalo en la fila de Enero a Diciembre.`;
      };
      $("#bvp-enviar").onclick = () => {
        const nombre = $("#bvp-nombre").value.trim() || datos.dueno || "Mi personaje";
        GM_setValue(LLAVE_ENVIO, JSON.stringify({
          nombre, anio: String($("#bvp-anio").value), metrica: $("#bvp-metrica").value,
          meses: valores(), origen: location.href, cuando: Date.now()
        }));
        $("#bvp-estado").innerHTML = `<span class="bvp-ok">Listo ✓</span> Abrí (o recargá) la app de Progresión y tocá «Cargar».`;
      };
    }
  }

  // =========================================================
  //  LADO APP: recibir los datos
  // =========================================================
  function esApp() {
    return location.hostname.endsWith("github.io") && !!document.getElementById("meses") && /progresi[oó]n de personaje/i.test(document.title);
  }

  function panelApp() {
    let envio;
    try { envio = JSON.parse(GM_getValue(LLAVE_ENVIO, "null")); } catch (_) { envio = null; }
    if (!envio || !Array.isArray(envio.meses) || envio.meses.length !== 12) return;
    estilos();

    let estado;
    try { estado = JSON.parse(localStorage.getItem(CLAVE_APP)); } catch (_) { estado = null; }
    const pj = estado && Array.isArray(estado.personajes)
      ? estado.personajes.find(p => (p.nombre || "").trim().toLowerCase() === envio.nombre.trim().toLowerCase()) : null;
    const yaTiene = pj && pj.anios && pj.anios[envio.anio] && pj.anios[envio.anio].meses.some(v => v != null && v !== 0);

    const total = envio.meses.reduce((a, b) => a + b, 0);
    const b = el("div", { className: "bvp-banner" });
    b.innerHTML = `
      <div>✿ Hay datos de la bóveda para <b>${esc(envio.nombre)}</b> · ${esc(envio.anio)} — ${esc(METRICAS[envio.metrica] || "")}: <b>${fmt(total)}</b> en el año.</div>
      ${yaTiene ? `<div class="bvp-nota">Ese personaje ya tiene meses cargados en ${esc(envio.anio)}: se van a reemplazar (las metas se mantienen).</div>`
                : pj ? "" : `<div class="bvp-nota">No existe un personaje con ese nombre: se va a crear.</div>`}
      <div class="bvp-acc"><button class="bvp-pri" id="bvp-cargar">Cargar</button><button id="bvp-descartar">Descartar</button></div>`;
    document.body.appendChild(b);

    b.querySelector("#bvp-descartar").onclick = () => { GM_deleteValue(LLAVE_ENVIO); b.remove(); };
    b.querySelector("#bvp-cargar").onclick = () => {
      if (!estado || !Array.isArray(estado.personajes)) estado = { version: 1, activo: null, personajes: [] };
      let p = pj;
      if (!p) {
        p = { id: Math.random().toString(36).slice(2, 10), nombre: envio.nombre, lema: "", anioActivo: envio.anio, anios: {} };
        // si la app solo tiene el personaje vacío de ejemplo, lo reemplaza
        const vacio = estado.personajes.length === 1 && estado.personajes[0].nombre === "Mi personaje" &&
          Object.values(estado.personajes[0].anios || {}).every(a => a.metaAnual == null && a.metaMensual == null && a.meses.every(v => v == null));
        if (vacio) estado.personajes = [];
        estado.personajes.push(p);
      }
      if (!p.anios[envio.anio]) p.anios[envio.anio] = { metaAnual: null, metaMensual: null, meses: Array(12).fill(null) };
      p.anios[envio.anio].meses = envio.meses.map(v => v || null);
      p.anioActivo = envio.anio;
      estado.activo = p.id;
      localStorage.setItem(CLAVE_APP, JSON.stringify(estado));
      GM_deleteValue(LLAVE_ENVIO);
      location.reload();
    };
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // =========================================================
  if (esBoveda()) panelForo();
  else if (esApp()) panelApp();
})();

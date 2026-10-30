// ==UserScript==
// @name         Bóveda → Progresión de Personaje
// @namespace    hp-avada-kedavra.progresion
// @version      2.6
// @description  Censo de todas las bóvedas (ranking de grageas, camadas por activación, casas, jugadores, inactivos) + progresión anual de cada personaje.
// @match        https://hp-avada-kedavra.foroactivo.com/*
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
  if (window.top !== window.self) return;

  // ─────────────────────────── constantes ───────────────────────────
  const LISTA_URL = "/t85-lista-de-bovedas";
  const K_CENSO = "censo-v1", K_METAS = "metas-v1", K_PREF = "pref-v1", K_ENVIO = "envio-boveda";
  const CLAVE_APP = "progresion-personaje-v1";
  const PAUSA_MS = 350;
  const POR_PAGINA = 15;
  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const MES_IDX = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 };
  const CASAS = ["Gryffindor","Slytherin","Ravenclaw","Hufflepuff"];
  const COLOR_CASA = { Gryffindor:"#f4a7a7", Slytherin:"#9fd8b8", Ravenclaw:"#a9c6f2", Hufflepuff:"#f7dc8a", "Sin casa":"#d9cdea" };
  const METRICAS = { ganadas:"Ganadas (sin veteranía ni etapa)", gastadas:"Gastadas (suma de los «−»)" };

  // ─────────────────────────── utilidades ───────────────────────────
  const fmt = n => (n == null || isNaN(n)) ? "—" : Math.round(n).toLocaleString("es-AR");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const leerGM = (k, d) => { try { const v = GM_getValue(k, null); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const guardarGM = (k, v) => { try { GM_setValue(k, JSON.stringify(v)); } catch (e) { console.warn("[Censo]", e); } };
  const sinTildes = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

  // "4 000", "70 741", "14,000", "1.370", "4000" -> entero
  const RE_NUM = /\d{1,3}(?:[ .,  ]\d{3})+(?!\d)|\d+/;
  function aNumero(t) {
    if (t == null) return null;
    const m = String(t).match(RE_NUM);
    return m ? parseInt(m[0].replace(/\D/g, ""), 10) : null;
  }

  function leerMovimiento(texto, ini, act) {
    const t = (texto || "").trim();
    if (!t) return { mas: 0, menos: 0 };
    const quita = /quit|gast|rest|desc|pag|compr/i.test(t);
    const pone = /añad|sum|gan|ingres|recib/i.test(t);
    const total = t.match(/\(\s*([+\-−–]?\s*\d[\d .,]*)\s*\)/);
    const RE_TOK = /[+\-−–]?\s*(?:\d{1,3}(?:[ .,  ]\d{3})+(?!\d)|\d+)/g;
    const partes = total ? [total[1]] : (t.replace(/\([^)]*\)/g, " ").match(RE_TOK) || []);
    const defecto = quita ? -1 : pone ? 1 : (ini != null && act != null ? (act < ini ? -1 : 1) : 1);
    let mas = 0, menos = 0;
    for (const p0 of partes) {
      const p = p0.trim();
      const n = aNumero(p);
      if (!n) continue;
      const signo = /^[\-−–]/.test(p) ? -1 : /^\+/.test(p) ? 1 : defecto;
      if (signo > 0) mas += n; else menos += n;
    }
    return { mas, menos };
  }

  function leerFechaPost(texto) {
    const t = (texto || "").toLowerCase();
    const hoy = new Date();
    if (/\bhoy\b/.test(t)) return [hoy.getFullYear(), hoy.getMonth(), hoy.getDate()];
    if (/\bayer\b/.test(t)) { const a = new Date(Date.now() - 864e5); return [a.getFullYear(), a.getMonth(), a.getDate()]; }
    const m = t.match(/(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-zé]*\.?\s+(\d{4})/);
    return m ? [+m[3], MES_IDX[m[2]], +m[1]] : null;
  }
  function leerFechaDMY(t) {
    const m = String(t || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? [+m[3], +m[2] - 1, +m[1]] : null;
  }
  const fechaTxt = f => f ? `${String(f[2]).padStart(2, "0")}/${String(f[1] + 1).padStart(2, "0")}/${f[0]}` : "—";
  const fechaNum = f => f ? f[0] * 10000 + f[1] * 100 + f[2] : 0;
  function mesesDesde(f) {
    if (!f) return null;
    const h = new Date();
    return Math.max(1, (h.getFullYear() - f[0]) * 12 + (h.getMonth() - f[1]) + 1);
  }

  // texto de un elemento con " | " entre cada pedazo, para que "Iniciales</div><div>14.000" quede "Iniciales | 14.000"
  function textoSeparado(el) {
    const w = (el.ownerDocument || document).createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const partes = [];
    for (let n; (n = w.nextNode());) {
      if (n.parentNode && /^(STYLE|SCRIPT)$/.test(n.parentNode.nodeName)) continue;
      const t = n.textContent.trim(); if (t) partes.push(t);
    }
    return partes.join(" | ");
  }

  async function traer(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
    return new DOMParser().parseFromString(await r.text(), "text/html");
  }

  // ─────────────────────────── lectura del foro ───────────────────────────
  // Lista de Bóvedas: [{tid, num, nombre, url}]
  async function leerLista() {
    const doc = await traer(LISTA_URL);
    const cont = doc.querySelector(".post .content");
    if (!cont) throw new Error("No encontré la Lista de Bóvedas");
    const salida = [], vistos = new Set();
    cont.querySelectorAll("a[href]").forEach(a => {
      const m = a.getAttribute("href").match(/\/t(\d+)(?:p\d+)?-([^?#]*)/);
      if (!m || m[1] === "85") return;
      // número de bóveda: el texto "NNN - " justo antes del link
      let prev = a.previousSibling, txt = "";
      while (prev && txt.length < 30) { txt = (prev.textContent || "") + txt; if (/\d+\s*-\s*$/.test(txt)) break; prev = prev.previousSibling; }
      const n = txt.match(/(\d{1,4})\s*-\s*$/);
      if (!n || vistos.has(m[1])) return;
      vistos.add(m[1]);
      salida.push({ tid: m[1], num: +n[1], nombre: a.textContent.trim(), slug: m[2] || "boveda" });
    });
    return salida;
  }

  function leerCaja(caja) {
    // se lee como texto línea por línea: "{Grageas actuales» 153 grageas"
    // (sirve tanto para cajas con .scaja-form como para las hechas a mano con <strong>)
    const copia = caja.cloneNode(true);
    copia.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    copia.querySelectorAll("div,p").forEach(d => d.append("\n"));
    const campos = {};
    copia.textContent.split("\n").forEach(linea => {
      const m = linea.match(/\{\s*([^»}]+?)\s*[»}]\s*(.*)$/);
      if (m) campos[m[1].trim().toLowerCase()] = m[2].trim();
    });
    const busca = re => { const k = Object.keys(campos).find(k => re.test(k)); return k ? campos[k] : null; };
    const mov = busca(/añad|quit/);
    if (mov == null && busca(/actual/) == null) return null; // no es de grageas (ej. "Nuevo inventario")
    return { ini: aNumero(busca(/inicial/)), mov: mov || "", tieneMov: mov != null, act: aNumero(busca(/actual/)), tot: aNumero(busca(/total/)), concepto: (busca(/enlace|concepto|motivo/) || "") + " " + [...caja.querySelectorAll("a[href]")].map(a => decodeURIComponent(a.getAttribute("href"))).join(" ") };
  }

  function leerPerfil(pp) {
    if (!pp) return {};
    const campos = {};
    pp.querySelectorAll(".profileField").forEach(f => {
      const l = f.querySelector(".label");
      if (!l) return;
      const clave = sinTildes(l.textContent).replace(/[:\s]+$/g, "").trim().toLowerCase();
      campos[clave] = f.textContent.replace(l.textContent, "").trim();
    });
    const rangoEl = pp.querySelector(".rango");
    const rango = rangoEl ? ((rangoEl.querySelector("img") || {}).title || rangoEl.textContent).trim() : "";
    const todo = rango + " " + [...pp.querySelectorAll("img[title], img[alt]")].map(i => i.title || i.alt).join(" ");
    const casa = CASAS.find(c => new RegExp(c, "i").test(todo)) || null;
    return {
      activacion: leerFechaDMY(campos["fecha de activacion"]),
      inscripcion: leerFechaDMY(campos["fecha de inscripcion"]),
      raza: campos["raza"] || "", etapa: campos["etapa"] || "", curso: campos["curso"] || "",
      faccion: campos["faccion"] || "", multicuenta: campos["multicuenta"] || "",
      rango, casa, exCasa: casa ? /\bex/i.test(rango) : false,
      inactivo: /inactiv/i.test(rango)
    };
  }

  function totalPaginas(doc, tid) {
    let n = 1;
    doc.querySelectorAll(".pagination").forEach(p => { const m = p.textContent.match(/P[aá]gina\s*\d+\s*de\s*(\d+)/i); if (m) n = Math.max(n, +m[1]); });
    doc.querySelectorAll(`a[href*="/t${tid}p"]`).forEach(a => { const m = a.getAttribute("href").match(new RegExp(`/t${tid}p(\\d+)-`)); if (m) n = Math.max(n, Math.floor(+m[1] / POR_PAGINA) + 1); });
    return n;
  }

  const RE_INICIAL = /veteran|etapa|grageas? iniciales|bienvenida/i;
  const NUMRE = "(\\d{1,3}(?:[ .,\\u00a0\\u202f]\\d{3})+(?!\\d)|\\d+)";

  // posts escritos a mano, sin caja: "Grageas actuales: 160 · +525 grageas por sueldos · Grageas restantes: 1.205 · Grageas totales: 106.972"
  function leerLibre(cont) {
    const copia = cont.cloneNode(true);
    copia.querySelectorAll("blockquote, .codebox, script, style").forEach(e => e.remove());
    copia.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    copia.querySelectorAll("div,p,li,tr").forEach(d => d.append("\n"));
    const t = copia.textContent.replace(/[ \t]+/g, " ");
    if (!/gra[gj]eas\s+(?:restantes|totales|actuales)\s*:/i.test(t)) return null;
    const val = lab => { const m = t.match(new RegExp(`gra[gj]eas\\s+${lab}\\s*:\\s*${NUMRE}`, "i")); return m ? aNumero(m[1]) : null; };
    const ini = val("actuales"), rest = val("restantes"), tot = val("totales");
    const partes = [];
    const re = new RegExp(`(?<=^|[\\s|(:.])([+\\-−–])\\s*${NUMRE}\\s*gra[gj]eas?\\s*(?:por\\s+)?([^\\n+\\-−–]{0,140})`, "gi");
    for (let m; (m = re.exec(t));) partes.push({ signo: m[1] === "+" ? 1 : -1, n: aNumero(m[2]), concepto: m[3] || "" });
    if (!partes.length && rest == null && tot == null) return null;
    return { ini, act: rest != null ? rest : (partes.length ? null : ini), tot, partes,
      enlaces: [...cont.querySelectorAll("a[href]")].map(a => { try { return decodeURIComponent(a.getAttribute("href")); } catch (_) { return a.getAttribute("href"); } }).join(" ") };
  }

  function leerPostsDePagina(doc, movs, esPrimeraPagina) {
    doc.querySelectorAll(".post").forEach((post, idx) => {
      if (esPrimeraPagina && idx === 0) return; // el primer post es la cabecera de la bóveda, no un movimiento
      const pid = +((post.id || "").replace(/\D/g, "") || (post.className.match(/post--(\d+)/) || [])[1] || 0);
      const autor = post.querySelector("p.author");
      const f = leerFechaPost(autor ? autor.textContent : "");
      if (!f) return;
      const caja = post.querySelector(".scaja-content");
      let ganado = 0, menos = 0, inicial = 0, act, tot, ini, ajuste = 0;
      if (caja) {
        const c = leerCaja(caja);
        if (!c) return;
        const r = leerMovimiento(c.mov, c.ini, c.act);
        // la veteranía y los cambios de etapa son grageas INICIALES, nunca ganadas
        if (RE_INICIAL.test(c.concepto + " " + c.mov)) inicial = r.mas; else ganado = r.mas;
        menos = r.menos; act = c.act; tot = c.tot; ini = c.ini;
        // corrección/revisión (típicamente de moderación): trae totales pero no dice qué se añadió.
        // Ahí suelen entrar cambios de etapa o arreglos de iniciales → no se cuenta como ganado.
        if (!c.tieneMov) ajuste = 1;
      } else {
        const cont = post.querySelector(".content");
        const l = cont && leerLibre(cont);
        if (!l) return;
        const todoInicial = RE_INICIAL.test(l.enlaces) && l.partes.length === 1;
        l.partes.forEach(p => {
          if (p.signo < 0) menos += p.n;
          else if (todoInicial || RE_INICIAL.test(p.concepto)) inicial += p.n;
          else ganado += p.n;
        });
        act = l.act; tot = l.tot; ini = l.ini;
      }
      movs.set(pid || `${fechaNum(f)}-${movs.size}`, [pid, f[0], f[1], f[2], ganado, menos, act ?? null, tot ?? null, ini ?? null, inicial, ajuste]);
    });
  }

  // Lo ganado por mes: lo que suben las «Grageas totales» (así entra también lo que no se anotó como movimiento),
  // menos lo que fue veteranía o etapa. Si un post no trae totales, se usan sus «+».
  function calcularGanancias(lista, base, extra) {
    const ganMes = {};
    let ajustes = 0; const listaAjustes = [];
    const sumar = (y, m, v) => { if (v > 0) { const k = `${y}-${m}`; ganMes[k] = (ganMes[k] || 0) + v; } };
    let corriendo = base;
    for (const m of lista) {
      if (m[7] != null && corriendo != null) {
        if (m[7] > corriendo) {
          if (m[10]) { ajustes += m[7] - corriendo; listaAjustes.push([m[1], m[2], m[7] - corriendo]); } // corrección sin concepto: no es ganado
          else sumar(m[1], m[2], m[7] - corriendo - (m[9] || 0));
          corriendo = m[7];
        }
      } else if (!m[10]) sumar(m[1], m[2], m[4]);
      if (corriendo == null && m[7] != null) corriendo = m[7];
    }
    const sumaGan = () => Object.values(ganMes).reduce((a, b) => a + b, 0);
    // si la cabecera trae «Generales» y todavía falta, las correcciones sí eran ganancias: vuelven a su mes
    if (extra && extra.gen != null) for (const [y, m, v] of listaAjustes) {
      const falta = extra.gen - sumaGan(); if (falta <= 0) break;
      const d = Math.min(v, falta); sumar(y, m, d); ajustes -= d;
    }
    if (extra && extra.tot != null && corriendo != null && extra.tot > corriendo) {
      let resto = extra.tot - corriendo;
      // con el desglose «Generales» de la cabecera, lo ganado nunca puede pasarse de ese número
      if (extra.gen != null) resto = Math.min(resto, Math.max(0, extra.gen - sumaGan()));
      sumar(extra.fecha[0], extra.fecha[1], resto);
    }
    return { ganMes, ajustes };
  }

  // Lee (o actualiza) una bóveda. previo = datos guardados o null
  // modo: "rapida"  → solo la 1ª página (cabecera + perfil); conserva los movimientos ya leídos
  //       "movs"    → además lee las páginas nuevas (o todas, si nunca se leyó completa)
  //       "completa"→ relee todas las páginas desde cero
  async function leerBoveda(item, previo, modo, aviso) {
    const base = `/t${item.tid}`, slug = item.slug || "boveda";
    const urlPag = i => i ? `${base}p${i * POR_PAGINA}-${slug}` : `${base}-${slug}`;
    const doc0 = await traer(urlPag(0));
    const n = totalPaginas(doc0, item.tid);
    const primero = doc0.querySelector(".post");
    const autor = primero && primero.querySelector("p.author");
    const linkU = autor && autor.querySelector('a[href*="/u"]');
    const dueno = autor && autor.querySelector("strong") ? autor.querySelector("strong").textContent.trim() : (item.nombre || "");
    const uid = linkU ? (linkU.getAttribute("href").match(/\/u(\d+)/) || [])[1] : null;
    const perfil = leerPerfil(primero && primero.querySelector(".postprofile"));
    // cabecera del primer post ("Grageas Iniciales: 4 000" o una cabecera armada a mano con "Iniciales | 14.000")
    const contCab = primero && primero.querySelector(".content");
    const cab = contCab ? textoSeparado(contCab) : "";
    const deCab = lab => {
      const m = cab.match(new RegExp(`(?:gra[gj]eas\\s+)?${lab}\\s*[:»}]?\\s*(?:\\|\\s*)*(\\d{1,3}(?:[ .,\\u00a0\\u202f]\\d{3})+(?!\\d)|\\d+)`, "i"));
      return m ? aNumero(m[1]) : null;
    };
    const cabIni = deCab("iniciales"), cabTot = deCab("totales"), cabAct = deCab("actuales");
    const cabGen = deCab("generales"); // desglose de la cabecera: lo ganado activamente
    const edic = primero ? (primero.textContent.match(/[UÚ]ltima edici[oó]n por .+? el (.+?),?\s*editado/i) || [])[1] : null;
    const fechaEdic = edic ? leerFechaPost(edic) : null;

    const movs = new Map((previo && modo !== "completa" ? previo.movs || [] : []).map(m => [m[0], m]));
    leerPostsDePagina(doc0, movs, true);
    let completo = !!(previo && previo.completo && modo !== "completa"), leidas = previo ? previo.paginasLeidas || 1 : 1;
    const desde = modo === "rapida" ? n : (completo ? Math.max(1, leidas - 1) : 1);
    for (let i = desde; i < n; i++) {
      aviso && aviso(i + 1, n);
      await dormir(PAUSA_MS);
      leerPostsDePagina(await traer(urlPag(i)), movs);
    }
    if (modo !== "rapida") { completo = true; leidas = n; }
    const lista = [...movs.values()].sort((a, b) => (fechaNum([a[1], a[2], a[3]]) - fechaNum([b[1], b[2], b[3]])) || (a[0] - b[0]));
    const ult = lista[lista.length - 1];
    const ultTot = [...lista].reverse().find(m => m[7] != null);
    const ultAct = [...lista].reverse().find(m => m[6] != null);
    // la cabecera actualizada es requisito del foro: si está, manda ella; si no, el último post leído
    const postTot = ultTot ? ultTot[7] : null;
    const usarCab = cabTot != null && cabAct != null;
    // grageas iniciales = las de apertura + todo lo que llegó por veteranía o por etapa (no son ganadas activamente)
    const primeroConIni = lista.find(m => m[8] != null);
    const apertura = primeroConIni ? primeroConIni[8] : null;
    const { ganMes, ajustes } = calcularGanancias(lista, apertura, completo && usarCab ? { tot: cabTot, gen: cabGen, fecha: fechaEdic || [new Date().getFullYear(), new Date().getMonth()] } : null);
    const iniPost = apertura != null ? apertura + lista.reduce((s, m) => s + (m[9] || 0), 0) + ajustes : null;
    const totFinal = usarCab ? cabTot : (postTot != null ? postTot : cabTot);
    let iniciales = Math.max(cabIni ?? 0, iniPost ?? 0) || (cabIni ?? iniPost);
    if (cabGen != null && totFinal != null && totFinal - cabGen >= 0) iniciales = totFinal - cabGen; // si la cabecera trae «Generales», manda
    // solo se puede saber cuánto ganó si se conoce toda su veteranía/etapa: con «Generales» o con todos los movimientos leídos
    const iniVerif = cabGen != null || completo;
    let ultimoMov = ult ? [ult[1], ult[2], ult[3]] : null;
    if (previo && previo.ultimoMov && fechaNum(previo.ultimoMov) > fechaNum(ultimoMov)) ultimoMov = previo.ultimoMov;
    if (usarCab && fechaEdic && fechaNum(fechaEdic) > fechaNum(ultimoMov)) ultimoMov = fechaEdic;
    return {
      tid: item.tid, num: item.num, nombreLista: item.nombre, slug,
      dueno, uid, ...perfil,
      iniciales, iniVerif,
      actuales: usarCab ? cabAct : (ultAct ? ultAct[6] : cabAct),
      totales: totFinal,
      fuente: usarCab ? "cabecera" : "posts",
      ultimoMov, paginas: n, paginasLeidas: leidas, completo, movs: lista, ganMes, leido: Date.now()
    };
  }

  // ─────────────────────────── cálculos ───────────────────────────
  function sumaPeriodo(b, anio, mes) {
    let mas = 0, menos = 0, cant = 0;
    for (const m of b.movs || []) {
      if (anio && m[1] !== anio) continue;
      if (mes != null && m[2] !== mes) continue;
      mas += m[4]; menos += m[5]; if (m[4] || m[5]) cant++;
    }
    return { mas, menos, cant };
  }
  // en toda la historia se usan los números oficiales de la bóveda; en un año, la suma de los posts
  function ganado(b, anio) {
    if (!anio) return (b.iniVerif && b.totales != null && b.iniciales != null) ? Math.max(0, b.totales - b.iniciales) : null;
    return ganadoMes(b, anio, null);
  }
  function ganadoMes(b, anio, mes) {
    if (!b.ganMes) return sumaPeriodo(b, anio, mes).mas;
    let t = 0;
    for (const k in b.ganMes) { const [y, m] = k.split("-").map(Number); if (y === anio && (mes == null || m === mes)) t += b.ganMes[k]; }
    return t;
  }
  function gastado(b, anio) {
    if (!anio && b.totales != null && b.actuales != null) return Math.max(0, b.totales - b.actuales);
    return sumaPeriodo(b, anio).menos;
  }
  function mensual(b, anio, metrica) {
    const meses = Array(12).fill(0);
    const movs = b.movs || [];
    if (metrica === "totales") {
      let previo = null; const ultimo = Array(12).fill(null), vet = Array(12).fill(0);
      for (const m of movs) { if (m[1] === anio) vet[m[2]] += m[9] || 0; if (m[7] == null) continue; if (m[1] < anio) previo = m[7]; else if (m[1] === anio) ultimo[m[2]] = m[7]; }
      for (let i = 0; i < 12; i++) { if (ultimo[i] == null) continue; meses[i] = previo == null ? 0 : Math.max(0, ultimo[i] - previo - vet[i]); previo = ultimo[i]; }
      return meses;
    }
    if (metrica === "ganadas") return meses.map((_, i) => ganadoMes(b, anio, i));
    for (const m of movs) if (m[1] === anio) meses[m[2]] += m[5];
    return meses;
  }
  const casaDe = b => b.casa || "Sin casa";
  const claveNombre = s => {
    const t = sinTildes(s).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(x => x.length > 1);
    return t.length ? t[0] + " " + t[t.length - 1] : "";
  };
  function agruparJugadores(bovs) {
    const padre = new Map();
    const raiz = x => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
    const unir = (a, b) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) padre.set(ra, rb); };
    const porClave = new Map();
    bovs.forEach(b => {
      padre.set(b.tid, b.tid);
      [b.dueno, b.nombreLista].forEach(n => { const k = claveNombre(n); if (k && !porClave.has(k)) porClave.set(k, b.tid); });
    });
    bovs.forEach(b => {
      if (!b.multicuenta || /^ningun/i.test(b.multicuenta)) return;
      b.multicuenta.split(/\s*(?:,|&|\by\b|\/|;|\|)\s*/i).forEach(n => { const t = porClave.get(claveNombre(n)); if (t) unir(b.tid, t); });
    });
    const grupos = new Map();
    bovs.forEach(b => { const r = raiz(b.tid); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(b); });
    return [...grupos.values()];
  }

  // ─────────────────────────── estilos (magical girl) ───────────────────────────
  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  .fab{position:fixed;right:18px;bottom:18px;z-index:2147483000;border:0;cursor:pointer;border-radius:999px;padding:10px 16px;
    font:700 13px/1 Quicksand,"Century Gothic",system-ui,sans-serif;color:#6b3f7a;
    background:linear-gradient(135deg,#ffd6ec,#e5d4ff 55%,#cde9ff);box-shadow:0 6px 18px rgba(120,70,150,.28),inset 0 0 0 2px #fff;
    letter-spacing:.04em}
  .fab:hover{filter:brightness(1.04);transform:translateY(-1px)}
  .fondo{position:fixed;inset:0;z-index:2147483001;background:rgba(70,40,90,.38);display:flex;align-items:center;justify-content:center;padding:14px}
  .ven{width:min(1100px,100%);height:min(88vh,900px);display:flex;flex-direction:column;border-radius:22px;overflow:hidden;
    background:#fff9fd;color:#5a3d6b;font:500 13.5px/1.45 Quicksand,"Century Gothic",system-ui,sans-serif;
    box-shadow:0 24px 60px rgba(70,40,90,.4),inset 0 0 0 2px #fff}
  .cab{position:relative;padding:14px 18px 0;background:linear-gradient(120deg,#ffd6ec 0%,#e8d9ff 50%,#d3ecff 100%)}
  .cab h1{margin:0;font:700 19px/1.2 Quicksand,sans-serif;letter-spacing:.08em;color:#7a4790;text-shadow:0 1px 0 #fff}
  .cab h1 small{font-weight:600;font-size:12px;letter-spacing:.02em;color:#9a6fae;margin-left:8px}
  .chispa{position:absolute;color:#fff;font-size:14px;animation:tit 2.6s ease-in-out infinite;pointer-events:none;text-shadow:0 0 6px #ffb3dc}
  @keyframes tit{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1.1)}}
  .x{position:absolute;right:12px;top:10px;border:0;background:#fff;color:#7a4790;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:17px;box-shadow:0 2px 6px rgba(120,70,150,.2)}
  .tabs{display:flex;gap:4px;margin-top:10px;overflow-x:auto;scrollbar-width:none}
  .tab{border:0;cursor:pointer;padding:9px 14px;border-radius:14px 14px 0 0;background:rgba(255,255,255,.45);color:#8a5d9e;font:700 12.5px Quicksand,sans-serif;white-space:nowrap}
  .tab.on{background:#fff9fd;color:#6b3f7a}
  .cuerpo{flex:1;overflow:auto;padding:16px 18px 22px}
  .fila{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:12px}
  label.c{display:flex;flex-direction:column;gap:3px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#a07ab3;font-weight:700}
  select,input{font:600 13px Quicksand,system-ui,sans-serif;color:#5a3d6b;background:#fff;border:2px solid #f0dcf4;border-radius:12px;padding:6px 10px;min-width:0}
  select:focus,input:focus{outline:2px solid #e9a8d8;outline-offset:1px}
  .b{border:0;cursor:pointer;border-radius:12px;padding:8px 13px;font:700 12.5px Quicksand,sans-serif;color:#6b3f7a;background:#f6e9fb;box-shadow:inset 0 0 0 2px #ecd6f4;white-space:nowrap}
  .b:hover{background:#fde3f1}
  .b.pri{background:linear-gradient(135deg,#ffc6e4,#dcc9ff);box-shadow:inset 0 0 0 2px #fff,0 3px 10px rgba(200,120,190,.3)}
  .b:disabled{opacity:.5;cursor:default}
  .nota{font-size:12px;color:#a07ab3;margin:6px 0 0}
  .vacio{text-align:center;padding:50px 10px;color:#a07ab3}
  .vacio b{display:block;font-size:30px;margin-bottom:6px;color:#e9a8d8}
  table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.8px}
  th{position:sticky;top:-16px;background:#fbeefa;color:#8a5d9e;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:8px;cursor:pointer;white-space:nowrap;border-bottom:2px solid #f0dcf4}
  th.num,td.num{text-align:right}
  th.on{color:#c2489a}
  td{padding:7px 8px;border-bottom:1px solid #f5e8f6;vertical-align:middle}
  tr:hover td{background:#fff3fa}
  td.num{font-family:"DM Mono",Consolas,monospace;font-size:12.5px}
  .pos{font-weight:700;color:#c2489a;width:34px}
  .top1 .pos{color:#e0a400}.top2 .pos{color:#a8a8b8}.top3 .pos{color:#c98a5b}
  a.nom{color:#6b3f7a;font-weight:700;text-decoration:none}
  a.nom:hover{text-decoration:underline}
  .sub{display:block;font-size:11px;color:#b08cc0;font-weight:500}
  .chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#5a3d6b;white-space:nowrap}
  .tarjetas{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
  .t{border-radius:16px;padding:10px 12px;background:#fff;box-shadow:inset 0 0 0 2px #f3e3f6}
  .t .tt{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#a07ab3;font-weight:700}
  .t .tv{font:700 20px "DM Mono",Consolas,monospace;color:#6b3f7a;margin-top:4px}
  .t input{width:100%;margin-top:4px;font:700 17px "DM Mono",Consolas,monospace}
  .t.ok{background:#e3f6ea}
  .barra{height:8px;border-radius:6px;background:#f3e3f6;overflow:hidden;margin-top:6px}
  .barra i{display:block;height:100%;background:linear-gradient(90deg,#ffb3dc,#c9a8ff);border-radius:6px}
  .meses{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:12px 0}
  .mes{border-radius:14px;background:#fff;box-shadow:inset 0 0 0 2px #f3e3f6;padding:8px;text-align:center}
  .mes .mn{font-size:11px;font-weight:700;color:#8a5d9e}
  .mes .mv{font:700 16px "DM Mono",Consolas,monospace;color:#6b3f7a;margin:3px 0}
  .mes .ma{font-size:10.5px;color:#b08cc0}
  .mes .mp{margin-top:4px;border-radius:8px;font:700 11px "DM Mono",monospace;padding:2px 0;background:#fde3f1}
  .mes .mp.ok{background:#d8f3e2}
  .mes.hoy{box-shadow:inset 0 0 0 2px #e9a8d8}
  .barras .br{display:flex;align-items:center;gap:8px;margin:6px 0}
  .barras .bn{width:110px;font-weight:700;font-size:12.5px}
  .barras .bb{flex:1;height:22px;border-radius:10px;background:#f8eef9;overflow:hidden}
  .barras .bb i{display:block;height:100%;border-radius:10px}
  .barras .bv{width:110px;text-align:right;font:700 12.5px "DM Mono",monospace}
  .prog{height:12px;border-radius:8px;background:#f3e3f6;overflow:hidden;margin:10px 0 4px}
  .prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffb3dc,#c9a8ff,#a8d8ff);transition:width .3s}
  .caja{border-radius:16px;background:#fff;box-shadow:inset 0 0 0 2px #f3e3f6;padding:12px 14px;margin-bottom:12px}
  .caja h3{margin:0 0 6px;font-size:13px;color:#8a5d9e;letter-spacing:.04em}
  .err{color:#c2489a;font-size:12px}
  .grupo-n{font-size:11.5px;color:#a07ab3}
  svg{display:block;width:100%;height:auto}
  @media (max-width:700px){ .meses{grid-template-columns:repeat(3,1fr)} .barras .bn,.barras .bv{width:80px} .ven{height:94vh} }
  `;

  // ─────────────────────────── estado de la UI ───────────────────────────
  let censo = leerGM(K_CENSO, { actualizado: 0, lista: [], bovedas: {} });
  let metas = leerGM(K_METAS, {});
  let pref = Object.assign({ tab: "ranking", orden: "actuales", dir: -1, anioAct: "", casa: "", etapa: "", periodo: "", buscar: "", pjTid: "", pjAnio: "", pjMetrica: "ganadas" }, leerGM(K_PREF, {}));
  const guardarPref = () => guardarGM(K_PREF, pref);
  let raizUI, ven, escaneo = null;

  const tidActual = () => {
    const m = location.pathname.match(/^\/t(\d+)(?:p\d+)?-/);
    return m && document.querySelector(".scaja-content") ? m[1] : null;
  };

  function montar() {
    const host = document.createElement("div");
    host.id = "censo-avadense";
    document.body.appendChild(host);
    raizUI = host.attachShadow({ mode: "open" });
    const fuentes = document.createElement("link");
    fuentes.rel = "stylesheet";
    fuentes.href = "https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&family=DM+Mono:wght@500&display=swap";
    document.head.appendChild(fuentes);
    raizUI.innerHTML = `<style>${CSS}</style><button class="fab" type="button">✦ Censo de Bóvedas</button>`;
    raizUI.querySelector(".fab").onclick = abrir;
  }

  function abrir() {
    if (ven) return;
    const t = tidActual();
    if (t) { pref.pjTid = t; pref.tab = "progresion"; }
    const fondo = document.createElement("div");
    fondo.className = "fondo";
    fondo.innerHTML = `
      <div class="ven" role="dialog" aria-label="Censo de Bóvedas">
        <div class="cab">
          <span class="chispa" style="left:46%;top:8px">✦</span><span class="chispa" style="left:62%;top:22px;animation-delay:.9s">✧</span><span class="chispa" style="left:78%;top:6px;animation-delay:1.7s">✦</span>
          <h1>✿ CENSO DE BÓVEDAS <small id="sub"></small></h1>
          <button class="x" title="Cerrar">×</button>
          <div class="tabs">
            ${[["progresion","Mi progresión"],["ranking","Ranking"],["camadas","Camadas"],["casas","Casas"],["jugadores","Jugadores"],["inactivos","Inactivos"],["datos","Datos"]]
              .map(([k, v]) => `<button class="tab" data-tab="${k}">${v}</button>`).join("")}
          </div>
        </div>
        <div class="cuerpo" id="cuerpo"></div>
      </div>`;
    raizUI.appendChild(fondo);
    ven = fondo;
    fondo.addEventListener("click", e => { if (e.target === fondo) cerrar(); });
    fondo.querySelector(".x").onclick = cerrar;
    fondo.querySelectorAll(".tab").forEach(b => b.onclick = () => { pref.tab = b.dataset.tab; guardarPref(); pintar(); });
    document.addEventListener("keydown", teclaEsc);
    pintar();
  }
  function teclaEsc(e) { if (e.key === "Escape") cerrar(); }
  function cerrar() { if (!ven) return; ven.remove(); ven = null; document.removeEventListener("keydown", teclaEsc); }

  const $ = s => ven.querySelector(s);
  const bovedas = () => Object.values(censo.bovedas);

  function pintar() {
    if (!ven) return;
    ven.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === pref.tab));
    const n = bovedas().length;
    $("#sub").textContent = n ? `${n} bóvedas · ${censo.actualizado ? "actualizado " + new Date(censo.actualizado).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : ""}` : "";
    const c = $("#cuerpo");
    ({ progresion: tabProgresion, ranking: () => tabRanking(false), inactivos: () => tabRanking(true), camadas: tabCamadas, casas: tabCasas, jugadores: tabJugadores, datos: tabDatos }[pref.tab] || tabDatos)(c);
  }

  const vacioCenso = c => {
    c.innerHTML = `<div class="vacio"><b>✧</b>Todavía no leí ninguna bóveda.<br>Andá a la pestaña <b style="display:inline;font-size:inherit;color:#c2489a">Datos</b> y tocá «Actualizar censo».</div>`;
  };

  // ── opciones comunes de filtro
  const anios = () => [...new Set(bovedas().flatMap(b => (b.movs || []).map(m => m[1])))].sort((a, b) => b - a);
  const aniosAct = () => [...new Set(bovedas().map(b => b.activacion && b.activacion[0]).filter(Boolean))].sort((a, b) => b - a);
  const etapas = () => [...new Set(bovedas().map(b => b.etapa).filter(Boolean))].sort();
  const opt = (v, t, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? " selected" : ""}>${esc(t)}</option>`;

  function filtros(c, conCasa = true) {
    return `<div class="fila">
      <label class="c">Buscar<input id="f-buscar" value="${esc(pref.buscar)}" placeholder="nombre…"></label>
      <label class="c">Activados en<select id="f-act">${opt("", "Todos", pref.anioAct)}${aniosAct().map(a => opt(a, a, pref.anioAct)).join("")}</select></label>
      ${conCasa ? `<label class="c">Casa<select id="f-casa">${opt("", "Todas", pref.casa)}${[...CASAS, "Sin casa"].map(k => opt(k, k, pref.casa)).join("")}</select></label>` : ""}
      <label class="c">Etapa<select id="f-etapa">${opt("", "Todas", pref.etapa)}${etapas().map(e => opt(e, e, pref.etapa)).join("")}</select></label>
      <label class="c">Ganado / gastado en<select id="f-per">${opt("", "Toda la historia", pref.periodo)}${anios().map(a => opt(a, a, pref.periodo)).join("")}</select></label>
    </div>${avisoParcial()}`;
  }
  function avisoParcial() {
    if (!pref.periodo) {
      const sinVer = bovedas().filter(b => !b.iniVerif && !b.inactivo).length;
      return sinVer ? `<p class="nota" style="margin:-4px 0 10px;color:#c2489a">✧ ${sinVer} bóveda${sinVer === 1 ? "" : "s"} todavía no tienen los movimientos leídos: su «ganadas» aparece como — porque sin eso no sé cuánto les llegó por veteranía o etapa. Para completarlas: Datos → «Leer movimientos».</p>` : "";
    }
    const faltan = bovedas().filter(b => !b.completo).length;
    return faltan ? `<p class="nota" style="margin:-4px 0 10px;color:#c2489a">✧ ${faltan} bóveda${faltan === 1 ? "" : "s"} todavía no tienen los movimientos leídos, así que sus números de ${esc(pref.periodo)} pueden estar incompletos. Para completarlos: Datos → «Leer movimientos».</p>` : "";
  }
  function enlazarFiltros(c) {
    const on = (id, k) => { const e = c.querySelector(id); if (!e) return; e.addEventListener(e.tagName === "INPUT" ? "input" : "change", () => { pref[k] = e.value; guardarPref(); pintar(); if (id === "#f-buscar") { const n = $("#f-buscar"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); };
    on("#f-buscar", "buscar"); on("#f-act", "anioAct"); on("#f-casa", "casa"); on("#f-etapa", "etapa"); on("#f-per", "periodo");
  }
  function filtrar(lista, conCasa = true) {
    const q = sinTildes(pref.buscar).toLowerCase().trim();
    return lista.filter(b =>
      (!q || sinTildes(b.dueno + " " + b.nombreLista).toLowerCase().includes(q)) &&
      (!pref.anioAct || (b.activacion && String(b.activacion[0]) === String(pref.anioAct))) &&
      (!conCasa || !pref.casa || casaDe(b) === pref.casa) &&
      (!pref.etapa || b.etapa === pref.etapa));
  }
  const chipCasa = b => `<span class="chip" style="background:${COLOR_CASA[casaDe(b)]}">${b.exCasa ? "Ex-" : ""}${esc(casaDe(b))}</span>`;
  const linkBov = b => `<a class="nom" href="/t${b.tid}-${esc(b.slug || "boveda")}" target="_blank">${esc(b.dueno || b.nombreLista)}</a>`;

  // ─────────── Ranking / Inactivos
  function filas(lista) {
    const per = pref.periodo ? +pref.periodo : null;
    return lista.map(b => {
      const vida = mesesDesde(b.activacion);
      return { b, actuales: b.actuales, totales: b.totales, ganadas: ganado(b, per), gastadas: gastado(b, per),
        pormes: vida && ganado(b) != null ? ganado(b) / vida : null, activacion: fechaNum(b.activacion), ultimo: fechaNum(b.ultimoMov), nombre: (b.dueno || "").toLowerCase() };
    });
  }
  function ordenar(rows) {
    const k = pref.orden, d = pref.dir;
    return rows.sort((a, b) => {
      const x = a[k], y = b[k];
      if (typeof x === "string") return d * x.localeCompare(y);
      return d * ((x ?? -Infinity) - (y ?? -Infinity));
    });
  }
  function tabRanking(inactivos) {
    const c = $("#cuerpo");
    if (!bovedas().length) return vacioCenso(c);
    const rows = ordenar(filas(filtrar(bovedas().filter(b => !!b.inactivo === inactivos))));
    const perTxt = pref.periodo ? ` (${pref.periodo})` : "";
    const cols = [["nombre", "Personaje", ""], ["actuales", "Actuales", "num"], ["totales", "Totales", "num"], ["ganadas", "Ganadas" + perTxt, "num"],
      ["gastadas", "Gastadas" + perTxt, "num"], ["pormes", "Ganado / mes de vida", "num"], ["activacion", "Activación", ""], ["ultimo", "Último mov.", ""]];
    c.innerHTML = filtros(c) +
      (inactivos ? `<p class="nota" style="margin:-4px 0 10px">Personajes con rango «Inactivo» en su perfil. No entran en Ranking, Camadas, Casas ni Jugadores.</p>` : "") +
      (rows.length ? `<table><thead><tr><th class="num">#</th>${cols.map(([k, t, cl]) => `<th class="${cl}${pref.orden === k ? " on" : ""}" data-k="${k}">${t}${pref.orden === k ? (pref.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr></thead><tbody>
        ${rows.map((r, i) => `<tr class="top${i + 1}"><td class="pos num">${i + 1}</td>
          <td>${linkBov(r.b)} ${chipCasa(r.b)}<span class="sub">Bóveda ${String(r.b.num || "").padStart(3, "0")}${r.b.etapa ? " · " + esc(r.b.etapa) : ""}${r.b.raza ? " · " + esc(r.b.raza) : ""}</span></td>
          <td class="num">${fmt(r.actuales)}</td><td class="num">${fmt(r.totales)}</td><td class="num">${fmt(r.ganadas)}</td><td class="num">${fmt(r.gastadas)}</td>
          <td class="num">${fmt(r.pormes)}</td><td>${fechaTxt(r.b.activacion)}</td><td>${fechaTxt(r.b.ultimoMov)}</td></tr>`).join("")}
      </tbody></table>` : `<div class="vacio"><b>✧</b>Nadie coincide con esos filtros.</div>`);
    enlazarFiltros(c);
    c.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      if (pref.orden === k) pref.dir *= -1; else { pref.orden = k; pref.dir = k === "nombre" ? 1 : -1; }
      guardarPref(); pintar();
    });
  }

  // ─────────── Camadas (por año de activación)
  function tabCamadas(c) {
    if (!bovedas().length) return vacioCenso(c);
    const per = pref.periodo ? +pref.periodo : null;
    const activos = filtrar(bovedas().filter(b => !b.inactivo && b.activacion), true).filter(b => true);
    const porAnio = new Map();
    activos.forEach(b => { const a = b.activacion[0]; if (!porAnio.has(a)) porAnio.set(a, []); porAnio.get(a).push(b); });
    const anios = [...porAnio.keys()].sort((a, b) => b - a);
    c.innerHTML = filtros(c) + `<p class="nota" style="margin:-4px 0 12px">Cada camada son los personajes activados ese año. El podio es por grageas ganadas${per ? " en " + per : " en toda su historia"}.</p>` +
      (anios.length ? anios.map(a => {
        const g = porAnio.get(a).map(b => ({ b, gan: ganado(b, per) })).sort((x, y) => (y.gan ?? -1) - (x.gan ?? -1));
        const tot = g.reduce((s, x) => s + (x.gan || 0), 0);
        return `<div class="caja"><h3>✦ Camada ${a} · ${g.length} personaje${g.length === 1 ? "" : "s"} · ${fmt(tot)} ganadas · promedio ${fmt(tot / g.length)}</h3>
          <table><tbody>${g.map((x, i) => `<tr class="top${i + 1}"><td class="pos num">${i + 1}</td><td>${linkBov(x.b)} ${chipCasa(x.b)}<span class="sub">activado ${fechaTxt(x.b.activacion)}</span></td><td class="num">${fmt(x.gan)}</td><td class="num">${fmt(x.b.actuales)} <span class="sub">actuales</span></td></tr>`).join("")}</tbody></table></div>`;
      }).join("") : `<div class="vacio"><b>✧</b>No hay camadas con esos filtros.</div>`);
    enlazarFiltros(c);
  }

  // ─────────── Casas
  function tabCasas(c) {
    if (!bovedas().length) return vacioCenso(c);
    const per = pref.periodo ? +pref.periodo : null;
    const lista = filtrar(bovedas().filter(b => !b.inactivo), false);
    const datos = [...CASAS, "Sin casa"].map(k => {
      const g = lista.filter(b => casaDe(b) === k);
      const gan = g.reduce((s, b) => s + ganado(b, per), 0);
      const act = g.reduce((s, b) => s + (b.actuales || 0), 0);
      return { k, n: g.length, gan, act, prom: g.length ? gan / g.length : 0, actuales: g.filter(b => !b.exCasa).length };
    });
    const barras = (campo, titulo) => {
      const max = Math.max(1, ...datos.map(d => d[campo]));
      return `<div class="caja barras"><h3>${titulo}</h3>${[...datos].sort((a, b) => b[campo] - a[campo]).map(d => `<div class="br"><span class="bn">${esc(d.k)}</span><span class="bb"><i style="width:${d[campo] / max * 100}%;background:${COLOR_CASA[d.k]}"></i></span><span class="bv">${fmt(d[campo])}</span></div>`).join("")}</div>`;
    };
    // mes a mes del año elegido (o el más reciente)
    const anioMes = per || anios()[0];
    const tablaMes = anioMes ? `<div class="caja"><h3>✦ Ganadas por mes · ${anioMes}</h3><div style="overflow-x:auto"><table><thead><tr><th>Casa</th>${MESES.map(m => `<th class="num">${m.slice(0, 3)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
      ${[...CASAS, "Sin casa"].map(k => { const v = MESES.map((_, i) => lista.filter(b => casaDe(b) === k).reduce((s, b) => s + ganadoMes(b, anioMes, i), 0)); return `<tr><td><span class="chip" style="background:${COLOR_CASA[k]}">${k}</span></td>${v.map(x => `<td class="num">${x ? fmt(x) : "·"}</td>`).join("")}<td class="num"><b>${fmt(v.reduce((a, b) => a + b, 0))}</b></td></tr>`; }).join("")}
      </tbody></table></div></div>` : "";
    c.innerHTML = filtros(c, false) +
      `<p class="nota" style="margin:-4px 0 12px">Cuenta casa actual y ex-casa juntas (la casa de origen). Sin inactivos.</p>` +
      `<div class="tarjetas">${datos.map(d => `<div class="t" style="box-shadow:inset 0 0 0 3px ${COLOR_CASA[d.k]}"><div class="tt">${esc(d.k)}</div><div class="tv">${fmt(d.gan)}</div><div class="nota">${d.n} personajes (${d.actuales} en el colegio) · prom. ${fmt(d.prom)}</div></div>`).join("")}</div>` +
      barras("gan", `✦ Grageas ganadas${per ? " en " + per : " (toda la historia)"}`) + barras("act", "✦ Grageas actuales (lo que tienen hoy)") + barras("prom", "✦ Promedio ganado por personaje") + tablaMes;
    enlazarFiltros(c);
  }

  // ─────────── Jugadores (multicuentas)
  function tabJugadores(c) {
    if (!bovedas().length) return vacioCenso(c);
    const per = pref.periodo ? +pref.periodo : null;
    const grupos = agruparJugadores(bovedas().filter(b => !b.inactivo)).map(g => ({
      g, act: g.reduce((s, b) => s + (b.actuales || 0), 0), gan: g.reduce((s, b) => s + ganado(b, per), 0)
    })).sort((a, b) => b.act - a.act);
    const q = sinTildes(pref.buscar).toLowerCase().trim();
    const vis = grupos.filter(x => !q || x.g.some(b => sinTildes(b.dueno).toLowerCase().includes(q)));
    c.innerHTML = `<div class="fila">
        <label class="c">Buscar<input id="f-buscar" value="${esc(pref.buscar)}" placeholder="nombre…"></label>
        <label class="c">Ganado en<select id="f-per">${opt("", "Toda la historia", pref.periodo)}${anios().map(a => opt(a, a, pref.periodo)).join("")}</select></label></div>
      <p class="nota" style="margin:-4px 0 12px">Agrupa los personajes que se nombran entre sí en el campo «Multicuenta» del perfil. Ordenado por grageas actuales sumadas.</p>
      <table><thead><tr><th class="num">#</th><th>Personajes</th><th class="num">Actuales</th><th class="num">Ganadas${per ? " (" + per + ")" : ""}</th></tr></thead><tbody>
      ${vis.map((x, i) => `<tr class="top${i + 1}"><td class="pos num">${i + 1}</td><td>${x.g.map(b => linkBov(b) + " " + chipCasa(b)).join("<br>")}<span class="grupo-n">${x.g.length} cuenta${x.g.length === 1 ? "" : "s"}</span></td><td class="num">${fmt(x.act)}</td><td class="num">${fmt(x.gan)}</td></tr>`).join("")}
      </tbody></table>`;
    enlazarFiltros(c);
  }

  // ─────────── Mi progresión
  function tabProgresion(c) {
    const t = tidActual();
    const lista = bovedas().sort((a, b) => (a.dueno || "").localeCompare(b.dueno || ""));
    let b = censo.bovedas[pref.pjTid] || null;
    if (!b && !t) {
      if (!lista.length) return vacioCenso(c);
      b = lista[0]; pref.pjTid = b.tid;
    }
    const sel = `<label class="c">Personaje<select id="p-pj">${!censo.bovedas[pref.pjTid] && t ? opt(t, "Esta bóveda (sin leer)", t) : ""}${lista.map(x => opt(x.tid, x.dueno || x.nombreLista, pref.pjTid)).join("")}</select></label>`;
    if (!b) {
      c.innerHTML = `<div class="fila">${sel}</div><div class="vacio"><b>✧</b>Esta bóveda todavía no está en el censo.<br><br><button class="b pri" id="p-leer">Leer esta bóveda</button><p class="nota" id="p-est"></p></div>`;
      $("#p-pj").onchange = e => { pref.pjTid = e.target.value; guardarPref(); pintar(); };
      $("#p-leer").onclick = async () => {
        $("#p-leer").disabled = true;
        try {
          const item = { tid: t, num: aNumero(document.title) || 0, nombre: "", slug: (location.pathname.match(/^\/t\d+(?:p\d+)?-(.*)$/) || [])[1] || "boveda" };
          censo.bovedas[t] = await leerBoveda(item, null, "completa", (i, n) => { const e = $("#p-est"); if (e) e.textContent = `Leyendo página ${i} de ${n}…`; });
          guardarGM(K_CENSO, censo); pintar();
        } catch (e) { const el = $("#p-est"); if (el) el.textContent = "No pude leerla: " + e.message; $("#p-leer").disabled = false; }
      };
      return;
    }
    const aniosPj = [...new Set((b.movs || []).map(m => m[1]))].sort((x, y) => y - x);
    const hoyA = new Date().getFullYear();
    if (!aniosPj.includes(hoyA)) aniosPj.unshift(hoyA);
    const ultimoConDatos = (b.movs || []).length ? b.movs[b.movs.length - 1][1] : hoyA;
    const anio = aniosPj.includes(+pref.pjAnio) && pref.pjAnioTid === b.tid ? +pref.pjAnio : ultimoConDatos;
    const metrica = METRICAS[pref.pjMetrica] ? pref.pjMetrica : "ganadas";
    const llave = `${b.tid}|${anio}`;
    const m = metas[llave] || {};
    const v = mensual(b, anio, metrica);
    let ac = 0; const acum = v.map(x => (ac += x));
    const total = ac, meta = +m.anual || 0, metaMes = +m.mensual || 0;
    const falta = Math.max(meta - total, 0), pct = meta ? total / meta : 0;
    const mesHoy = anio === hoyA ? new Date().getMonth() : -1;
    const animo = !meta ? "¡poné tu meta!" : pct >= 1 ? "¡meta cumplida! ✧" : pct >= .75 ? "¡ya casi!" : pct >= .5 ? "¡vas por la mitad!" : pct > 0 ? "¡sigue así!" : "¡a empezar!";

    c.innerHTML = `<div class="fila">${sel}
        <label class="c">Año<select id="p-anio">${aniosPj.map(a => opt(a, a, anio)).join("")}</select></label>
        <label class="c">Qué contar<select id="p-met">${Object.entries(METRICAS).map(([k, t]) => opt(k, t, metrica)).join("")}</select></label>
        <span style="flex:1"></span>
        <button class="b" id="p-releer" title="Volver a leer esta bóveda">⟲ Releer bóveda</button>
        <button class="b" id="p-copiar" title="12 números separados por tabulador, para Excel">Copiar números</button>
        <button class="b" id="p-app" title="Mandar a la app de GitHub">Enviar a la app</button></div>
      ${b.completo ? "" : `<p class="nota" style="margin:-4px 0 8px;color:#c2489a">✧ De esta bóveda solo leí la cabecera. Tocá «⟲ Releer bóveda» para traer todos sus movimientos y ver los meses.</p>`}
      <p class="nota" style="margin:-4px 0 12px">${linkBov(b)} ${chipCasa(b)} · activado ${fechaTxt(b.activacion)} · ${fmt(b.actuales)} grageas actuales · <span id="p-est">leída ${new Date(b.leido).toLocaleDateString("es-AR")}</span></p>
      <div class="tarjetas">
        <div class="t"><div class="tt">◎ Meta anual</div><input id="p-ma" type="number" min="0" value="${m.anual ?? ""}" placeholder="0"></div>
        <div class="t"><div class="tt">▦ Meta mensual <button class="b" id="p-div" style="padding:1px 6px;font-size:10px">÷12</button></div><input id="p-mm" type="number" min="0" value="${m.mensual ?? ""}" placeholder="0"></div>
        <div class="t"><div class="tt">✧ Progreso total</div><div class="tv">${fmt(total)}</div></div>
        <div class="t ${meta && !falta ? "ok" : ""}"><div class="tt">☾ Falta p/ la meta</div><div class="tv">${meta && !falta ? "¡Superada!" : fmt(falta)}</div></div>
        <div class="t ${pct >= 1 ? "ok" : ""}"><div class="tt">↗ % completado</div><div class="tv">${Math.round(pct * 100)}%</div><div class="barra"><i style="width:${Math.min(pct, 1) * 100}%"></i></div></div>
        <div class="t" style="text-align:center;display:flex;flex-direction:column;justify-content:center"><div style="font-size:22px;color:#e9a8d8">❦</div><b style="color:#c2489a">${animo}</b></div>
      </div>
      <div class="meses">${MESES.map((mn, i) => { const pm = metaMes ? v[i] / metaMes : 0; return `<div class="mes${i === mesHoy ? " hoy" : ""}"><div class="mn">${mn}</div><div class="mv">${fmt(v[i])}</div><div class="ma">acum. ${fmt(acum[i])}</div><div class="mp${pm >= 1 ? " ok" : ""}">${Math.round(pm * 100)}%</div></div>`; }).join("")}</div>
      <div class="caja">${grafico(v, acum, meta)}</div>`;

    const guardaMeta = () => { metas[llave] = { anual: $("#p-ma").value === "" ? null : +$("#p-ma").value, mensual: $("#p-mm").value === "" ? null : +$("#p-mm").value }; guardarGM(K_METAS, metas); };
    $("#p-ma").onchange = () => { guardaMeta(); pintar(); };
    $("#p-mm").onchange = () => { guardaMeta(); pintar(); };
    $("#p-div").onclick = () => { if (+$("#p-ma").value) { $("#p-mm").value = Math.round(+$("#p-ma").value / 12); guardaMeta(); pintar(); } };
    $("#p-pj").onchange = e => { pref.pjTid = e.target.value; guardarPref(); pintar(); };
    $("#p-anio").onchange = e => { pref.pjAnio = e.target.value; pref.pjAnioTid = b.tid; guardarPref(); pintar(); };
    $("#p-met").onchange = e => { pref.pjMetrica = e.target.value; guardarPref(); pintar(); };
    $("#p-copiar").onclick = () => { const txt = v.join("\t"); try { GM_setClipboard(txt, "text"); } catch (_) { navigator.clipboard && navigator.clipboard.writeText(txt); } $("#p-est").textContent = "copiado ✓"; };
    $("#p-app").onclick = () => { GM_setValue(K_ENVIO, JSON.stringify({ nombre: b.dueno, anio: String(anio), metrica, meses: v, cuando: Date.now() })); $("#p-est").textContent = "listo ✓ abrí la app y tocá «Cargar»"; };
    $("#p-releer").onclick = async () => {
      $("#p-releer").disabled = true;
      try { censo.bovedas[b.tid] = await leerBoveda({ tid: b.tid, num: b.num, nombre: b.nombreLista, slug: b.slug }, b, "movs", (i, n) => { const e = $("#p-est"); if (e) e.textContent = `leyendo página ${i} de ${n}…`; }); guardarGM(K_CENSO, censo); pintar(); }
      catch (e) { $("#p-est").textContent = "error: " + e.message; $("#p-releer").disabled = false; }
    };
  }

  function grafico(vals, acum, meta) {
    const W = 760, H = 240, L = 46, R = 12, T = 14, B = 28, iw = W - L - R, ih = H - T - B, paso = iw / 12;
    const max = Math.max(meta, acum[11], ...vals, 0);
    if (max <= 0) return `<p class="vacio" style="padding:30px">Todavía no hay grageas este año ✿</p>`;
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const tope = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(f => f * p).find(x => x >= max);
    const y = v => T + ih - v / tope * ih;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva del año"><defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc6e4"/><stop offset="1" stop-color="#dcc9ff"/></linearGradient></defs>`;
    for (let k = 0; k <= 4; k++) { const vv = tope * k / 4; s += `<line x1="${L}" x2="${W - R}" y1="${y(vv)}" y2="${y(vv)}" stroke="#f3e3f6"/><text x="${L - 6}" y="${y(vv) + 4}" text-anchor="end" font-size="10" fill="#a07ab3">${vv >= 1000 ? (vv / 1000).toLocaleString("es-AR") + "k" : fmt(vv)}</text>`; }
    vals.forEach((v, i) => { const h = v / tope * ih, x = L + paso * i + paso * .22; s += `<rect x="${x}" y="${T + ih - h}" width="${paso * .56}" height="${h}" rx="5" fill="url(#gb)"><title>${MESES[i]}: ${fmt(v)}</title></rect><text x="${L + paso * i + paso / 2}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="#8a5d9e">${MESES[i].slice(0, 3)}</text>`; });
    if (meta > 0) s += `<line x1="${L}" x2="${W - R}" y1="${y(meta)}" y2="${y(meta)}" stroke="#e9a8d8" stroke-width="1.6" stroke-dasharray="6 5"/><text x="${W - R}" y="${y(meta) - 5}" text-anchor="end" font-size="10.5" fill="#c2489a">meta ${fmt(meta)}</text>`;
    s += `<polyline points="${acum.map((v, i) => `${L + paso * i + paso / 2},${y(v)}`).join(" ")}" fill="none" stroke="#9b6cc7" stroke-width="2.4" stroke-linejoin="round"/>`;
    acum.forEach((v, i) => s += `<circle cx="${L + paso * i + paso / 2}" cy="${y(v)}" r="3.6" fill="#fff" stroke="#9b6cc7" stroke-width="2"><title>Acumulado a ${MESES[i]}: ${fmt(v)}</title></circle>`);
    return s + `</svg><p class="nota" style="text-align:center">barras: grageas del mes · línea: acumulado · punteada: meta anual</p>`;
  }

  // ─────────── Datos (actualizar / exportar)
  function tabDatos(c) {
    const n = bovedas().length;
    c.innerHTML = `
      <div class="caja"><h3>✦ Actualizar el censo</h3>
        <p class="nota" style="margin:0 0 10px"><b>Actualizar</b> lee solo la cabecera y el perfil de cada bóveda (la primera página): alcanza para el ranking, lo ganado en toda la historia, camadas, casas, jugadores e inactivos. Tarda un minuto más o menos.<br>
        <b>Leer movimientos</b> recorre además todas las páginas para tener lo ganado por año y por mes (filtros por año, tabla mes a mes, Mi progresión). La primera vez tarda bastante; después solo lee las páginas nuevas. Si lo cortás, sigue desde donde quedó.</p>
        <div class="fila" style="margin:0">
          <button class="b pri" id="d-act">✧ Actualizar</button>
          <button class="b" id="d-movs" title="Lee todas las páginas de cada bóveda (solo las nuevas si ya se leyeron)">▦ Leer movimientos (por año y mes)</button>
          <button class="b" id="d-todo" title="Vuelve a leer todas las páginas de todas las bóvedas">⟲ Releer todo desde cero</button>
          <button class="b" id="d-cancel" disabled>Detener</button>
        </div>
        <div class="prog"><i id="d-bar"></i></div>
        <p class="nota" id="d-est">${n ? `${n} bóvedas en el censo · ${bovedas().filter(b => b.inactivo).length} inactivas · ${bovedas().filter(b => b.completo).length} con movimientos leídos · última actualización ${censo.actualizado ? new Date(censo.actualizado).toLocaleString("es-AR") : "—"}` : "Todavía no hay datos."}</p>
        <div id="d-err" class="err"></div>
      </div>
      <div class="caja"><h3>✦ Exportar</h3>
        <div class="fila" style="margin:0"><button class="b" id="d-csv" ${n ? "" : "disabled"}>⇩ CSV (para Excel)</button><button class="b" id="d-json" ${n ? "" : "disabled"}>⇩ JSON (copia completa)</button><button class="b" id="d-imp">⇧ Importar JSON</button><input type="file" id="d-file" accept=".json,application/json" hidden></div>
        <p class="nota">El CSV trae una fila por personaje con sus datos de perfil y lo ganado/gastado de cada año.</p>
      </div>
      <div class="caja"><h3>✦ Ojo con</h3><p class="nota" style="margin:0">Iniciales, totales y actuales salen de la cabecera de la bóveda; si no tiene, del último post. Las iniciales incluyen la apertura, la veteranía y los cambios de etapa: nada de eso cuenta como ganado. Si la cabecera trae el desglose «Generales», eso es lo ganado. En «toda la historia», ganadas = totales − iniciales y gastadas = totales − actuales. En un año, se suman los «+» y «−» de los posts de ese año (la veteranía no cuenta como ganada). «Ganado / mes de vida» = (totales − iniciales) ÷ meses desde la activación. Casa, activación, raza, etapa y multicuentas salen del mini-perfil del dueño.</p></div>`;
    if (escaneo) { $("#d-act").disabled = $("#d-movs").disabled = $("#d-todo").disabled = true; $("#d-cancel").disabled = false; }
    $("#d-act").onclick = () => escanear("rapida");
    $("#d-movs").onclick = () => escanear("movs");
    $("#d-todo").onclick = () => escanear("completa");
    $("#d-cancel").onclick = () => { if (escaneo) escaneo.cancelar = true; };
    $("#d-csv").onclick = exportarCSV;
    $("#d-json").onclick = () => descargar(`censo-bovedas-${hoyISO()}.json`, JSON.stringify(censo), "application/json");
    $("#d-imp").onclick = () => $("#d-file").click();
    $("#d-file").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const d = JSON.parse(await f.text()); if (!d || typeof d.bovedas !== "object") throw 0; censo = d; guardarGM(K_CENSO, censo); pintar(); }
      catch (_) { $("#d-est").textContent = "Ese archivo no es una copia del censo."; }
    };
  }

  async function escanear(modo) {
    if (escaneo) return;
    escaneo = { cancelar: false, errores: [], inicio: Date.now() };
    const est = t => { const e = ven && $("#d-est"); if (e) e.textContent = t; };
    const bar = p => { const e = ven && $("#d-bar"); if (e) e.style.width = (p * 100).toFixed(1) + "%"; };
    if (ven) pintar();
    try {
      est("Leyendo la Lista de Bóvedas…");
      const lista = await leerLista();
      censo.lista = lista;
      // primero las nunca leídas, después las leídas hace más tiempo (así, si se corta, se retoma solo)
      const cuando = it => { const b = censo.bovedas[it.tid]; return !b ? 0 : (modo !== "rapida" && !b.completo) ? 1 : b.leido || 2; };
      const orden = [...lista].sort((a, b) => cuando(a) - cuando(b));
      for (let i = 0; i < orden.length; i++) {
        if (escaneo.cancelar) { est(`Detenido en ${i} de ${orden.length}. Lo leído quedó guardado.`); break; }
        const it = orden[i];
        bar(i / orden.length);
        try {
          const previo = censo.bovedas[it.tid];
          censo.bovedas[it.tid] = await leerBoveda(it, previo, modo, (p, n) => est(`(${i + 1}/${orden.length}) ${it.nombre} · página ${p} de ${n}`));
          est(`(${i + 1}/${orden.length}) ${it.nombre} ✓`);
          guardarGM(K_CENSO, censo);
        } catch (e) { escaneo.errores.push(`${it.nombre}: ${e.message}`); }
        await dormir(PAUSA_MS);
        if (i === orden.length - 1) { bar(1); est(`¡Listo! ${orden.length} bóvedas leídas ✧`); }
      }
      censo.actualizado = Date.now();
      guardarGM(K_CENSO, censo);
    } catch (e) { est("No pude leer la lista: " + e.message); }
    const errs = escaneo.errores;
    escaneo = null;
    if (ven && pref.tab === "datos") {
      const msg = $("#d-est").textContent; pintar(); $("#d-est").textContent = msg;
      if (errs.length) $("#d-err").innerHTML = "No pude leer:<br>" + errs.map(esc).join("<br>");
    }
  }

  const hoyISO = () => new Date().toISOString().slice(0, 10);
  function descargar(nombre, texto, tipo) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
    a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportarCSV() {
    const as = anios().sort((a, b) => a - b);
    const cab = ["Bóveda", "Personaje", "Casa", "Ex-casa", "Inactivo", "Activación", "Raza", "Etapa", "Curso", "Facción", "Multicuenta", "Iniciales", "Actuales", "Totales", "Último movimiento", ...as.flatMap(a => [`Ganadas ${a}`, `Gastadas ${a}`]), "Ganadas (historia)", "Gastadas (historia)", "Link"];
    const q = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const filasCsv = bovedas().sort((a, b) => (b.actuales || 0) - (a.actuales || 0)).map(b => [
      b.num, b.dueno, casaDe(b), b.exCasa ? "sí" : "", b.inactivo ? "sí" : "", fechaTxt(b.activacion), b.raza, b.etapa, b.curso, b.faccion, b.multicuenta,
      b.iniciales, b.actuales, b.totales, fechaTxt(b.ultimoMov), ...as.flatMap(a => [ganadoMes(b, a, null), sumaPeriodo(b, a).menos]), ganado(b), gastado(b),
      location.origin + `/t${b.tid}-${b.slug || "boveda"}`].map(q).join(";"));
    descargar(`censo-bovedas-${hoyISO()}.csv`, "﻿" + [cab.map(q).join(";"), ...filasCsv].join("\r\n"), "text/csv;charset=utf-8");
  }

  // ─────────────────────────── lado app de GitHub ───────────────────────────
  function panelApp() {
    let envio;
    try { envio = JSON.parse(GM_getValue(K_ENVIO, "null")); } catch (_) { envio = null; }
    if (!envio || !Array.isArray(envio.meses) || envio.meses.length !== 12) return;
    let estado;
    try { estado = JSON.parse(localStorage.getItem(CLAVE_APP)); } catch (_) { estado = null; }
    const pj = estado && Array.isArray(estado.personajes) ? estado.personajes.find(p => (p.nombre || "").trim().toLowerCase() === envio.nombre.trim().toLowerCase()) : null;
    const total = envio.meses.reduce((a, b) => a + b, 0);
    const host = document.createElement("div"); document.body.appendChild(host);
    const r = host.attachShadow({ mode: "open" });
    r.innerHTML = `<style>.bn{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99999;width:min(94vw,560px);background:#FCEFC7;color:#5C4433;border:1.5px solid #B08968;border-radius:14px;padding:12px 14px;box-shadow:0 12px 30px rgba(92,68,51,.25);font:500 13.5px/1.4 Quicksand,system-ui,sans-serif;display:flex;flex-direction:column;gap:8px}button{font:700 12.5px Quicksand,system-ui,sans-serif;border:1.5px solid #E6D7C3;background:#fff;color:#5C4433;border-radius:10px;padding:7px 12px;cursor:pointer;margin-right:6px}button.p{background:#C3E6D6}.n{font-size:11.5px;color:#7A5C43;font-style:italic}</style>
      <div class="bn"><div>✿ Datos de la bóveda para <b>${esc(envio.nombre)}</b> · ${esc(envio.anio)} — ${esc(METRICAS[envio.metrica] || "")}: <b>${fmt(total)}</b></div>
      ${pj ? "" : `<div class="n">No existe un personaje con ese nombre: se va a crear.</div>`}
      <div><button class="p" id="si">Cargar</button><button id="no">Descartar</button></div></div>`;
    r.getElementById("no").onclick = () => { GM_deleteValue(K_ENVIO); host.remove(); };
    r.getElementById("si").onclick = () => {
      if (!estado || !Array.isArray(estado.personajes)) estado = { version: 1, activo: null, personajes: [] };
      let p = pj;
      if (!p) {
        p = { id: Math.random().toString(36).slice(2, 10), nombre: envio.nombre, lema: "", anioActivo: envio.anio, anios: {} };
        const vacio = estado.personajes.length === 1 && estado.personajes[0].nombre === "Mi personaje" &&
          Object.values(estado.personajes[0].anios || {}).every(a => a.metaAnual == null && a.metaMensual == null && a.meses.every(v => v == null));
        if (vacio) estado.personajes = [];
        estado.personajes.push(p);
      }
      if (!p.anios[envio.anio]) p.anios[envio.anio] = { metaAnual: null, metaMensual: null, meses: Array(12).fill(null) };
      p.anios[envio.anio].meses = envio.meses.map(v => v || null);
      p.anioActivo = envio.anio; estado.activo = p.id;
      localStorage.setItem(CLAVE_APP, JSON.stringify(estado));
      GM_deleteValue(K_ENVIO); location.reload();
    };
  }

  // ─────────────────────────── arranque ───────────────────────────
  if (location.hostname.includes("foroactivo.com")) montar();
  else if (location.hostname.endsWith("github.io") && document.getElementById("meses") && /progresi[oó]n de personaje/i.test(document.title)) panelApp();

  // para pruebas
  window.__censoAvadense = { leerLista, leerBoveda, leerMovimiento, aNumero, leerFechaPost, agruparJugadores, abrir };
})();

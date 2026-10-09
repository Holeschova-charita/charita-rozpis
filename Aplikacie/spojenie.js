/* Spojenie dochádzky s Google tabuľkou (cez skript Charita pomocník) */
const API = "https://script.google.com/macros/s/AKfycbzeTbJuIlv-giijsjahwL5R3rIlcwvecLA3GIjYrsgxLJGyaDci936SQ__Fk5nbJ5Dv/exec";
const PIN_KLUC = "charita_pin";
const FRONTA_KLUC = "charita_cakajuce";

let PIN = "";
try { PIN = localStorage.getItem(PIN_KLUC) || ""; } catch(e) {}
if (!PIN) location.href = "../index.html";

function localKey(d){
  d = d || new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function noveId(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}
async function api(akcia, data){
  const telo = Object.assign({ akcia: akcia, pin: PIN }, data || {});
  const res = await fetch(API, { method: "POST", body: JSON.stringify(telo) });
  return res.json();
}

const Spoj = {
  rola: null,
  meno: null,

  stav(text, chyba){
    const el = document.getElementById("syncNote");
    if (!el) return;
    el.textContent = text;
    el.style.color = chyba ? "#A63D5B" : "";
  },

  async login(){
    const r = await api("login");
    if (!r.ok) {
      if (r.zlyPin) { try { localStorage.removeItem(PIN_KLUC); } catch(e) {} location.href = "../index.html"; }
      throw new Error(r.chyba || "Chyba prihlásenia");
    }
    Spoj.rola = r.rola; Spoj.meno = r.meno;
    return r;
  },
  jeVeduca(){ return Spoj.rola === "vedúca"; },

  fronta(){ try { return JSON.parse(localStorage.getItem(FRONTA_KLUC)) || []; } catch(e){ return []; } },
  ulozFrontu(f){ localStorage.setItem(FRONTA_KLUC, JSON.stringify(f)); },

  // Stiahne záznamy z tabuľky a pridá k nim tie, ktoré ešte čakajú na odoslanie.
  async stiahniZaznamy(meno, kluc){
    const r = await api("zaznamy", { meno: meno });
    if (!r.ok) throw new Error(r.chyba || "Chyba");
    const out = r.zaznamy || {};
    Spoj.fronta().filter(q => q.meno === meno).forEach(q => {
      const den = out[q.datum] = out[q.datum] || [];
      if (!den.some(e => e.id === q.id)) {
        const e = { id: q.id, type: q.type, time: q.time };
        if (q.klient) e.klient = q.klient;
        den.push(e);
        den.sort((a,b) => a.time < b.time ? -1 : 1);
      }
    });
    localStorage.setItem(kluc, JSON.stringify(out));
    return out;
  },

  async stiahniAbsencie(meno, kluc){
    const r = await api("absencie", { meno: meno });
    if (!r.ok) throw new Error(r.chyba || "Chyba");
    localStorage.setItem(kluc, JSON.stringify(r.absencie || []));
    return r.absencie || [];
  },

  // Nový záznam: najprv do fronty (nestratí sa ani bez signálu), potom odoslať.
  async odosli(meno, zaznam){
    const f = Spoj.fronta();
    f.push(Object.assign({ meno: meno }, zaznam));
    Spoj.ulozFrontu(f);
    await Spoj.odosliFrontu();
  },

  async odosliFrontu(){
    let f = Spoj.fronta();
    if (!f.length) { Spoj.stav("Uložené v tabuľke ✓"); return; }
    Spoj.stav("Odosielam…");
    for (const q of f.slice()) {
      try {
        const r = await api("pridaj", { meno: q.meno, zaznam: q });
        if (!r.ok && r.zlyPin) { Spoj.stav("PIN neplatí – prihlás sa znova.", true); return; }
        if (!r.ok) console.warn("Záznam odmietnutý:", r.chyba, q);
        f = Spoj.fronta().filter(x => x.id !== q.id);
        Spoj.ulozFrontu(f);
      } catch(e) {
        Spoj.stav("Bez spojenia – " + Spoj.fronta().length + " záznam(y) čaká na odoslanie. Odošle sa automaticky.", true);
        return;
      }
    }
    Spoj.stav("Uložené v tabuľke ✓");
  },

  // Oprava celého dňa (len vedúca).
  async nahradDen(meno, datum, zoznam){
    const r = await api("nahradDen", { meno: meno, datum: datum, zaznamy: zoznam });
    if (!r.ok) throw new Error(r.chyba || "Chyba");
    return r;
  }
};

setInterval(() => Spoj.odosliFrontu(), 60000);
window.addEventListener("online", () => Spoj.odosliFrontu());

/* ===== PRIEPUSTKY: čas od–do ===== */
// Čas sa ukladá na začiatok poznámky, napr. "08:00-12:00 | lekár".
// Rozpozná aj staršie zápisy typu "Od 8-12 hod".
function priepustkaCas(a){
  if(!a || a.typ !== "prie") return null;
  const m = String(a.poznamka || "").match(/(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if(!m) return null;
  const odMin = Number(m[1]) * 60 + Number(m[2] || 0);
  const doMin = Number(m[3]) * 60 + Number(m[4] || 0);
  if(doMin <= odMin || doMin > 24 * 60) return null;
  const hm = x => String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0");
  return { od: hm(odMin), do: hm(doMin), ms: (doMin - odMin) * 60000 };
}
// Text poznámky bez časového údaja (na zobrazenie).
function priepustkaText(a){
  return String(a.poznamka || "").replace(/(od\s*)?\d{1,2}(?:[:.]\d{2})?\s*[-–]\s*\d{1,2}(?:[:.]\d{2})?\s*(hod\.?)?\s*\|?\s*/i, "").trim();
}

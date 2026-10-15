import React, { useState, useEffect, useCallback, useRef } from "react";
import { T, R, ui } from "../theme.js";
import { Icone } from "../icons.jsx";

// Galerie produit : photo principale + vignettes (photos, vidéo), points forts illustrés,
// agrandissement plein écran. La vidéo YouTube (youtube-nocookie) n'est chargée qu'au clic.
// media = { photos: [{ src, full, thumb? }], video: { youtube, title } | null, highlights: [{ src, title, text }] }
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const imgProps = { referrerPolicy: "no-referrer", loading: "lazy", decoding: "async" };

export function Lightbox({ photos, index, onClose, onIndex }) {
  const n = photos.length;
  const [bad, setBad] = useState({});   // url → image indisponible
  const boxRef = useRef(null), closeRef = useRef(null), tx = useRef(null);
  // original si disponible, sinon la version redimensionnée ; photo sautée si les deux échouent
  const urlOf = (p) => p && (p.full && !bad[p.full] ? p.full : !bad[p.src] ? p.src : null);
  const step = (from, d) => { for (let k = 1; k <= n; k++) { const j = (((from + d * k) % n) + n) % n; if (urlOf(photos[j])) return j; } return -1; };
  const go = useCallback((d) => { const j = step(index, d); if (j < 0) onClose(); else onIndex(j); }, [index, n, bad, onClose, onIndex]);   // eslint-disable-line
  const url = urlOf(photos[index]);
  useEffect(() => { if (n && !url) { const j = step(index, 1); if (j < 0) onClose(); else onIndex(j); } }, [url]);   // eslint-disable-line
  // le clavier reste dans la fenêtre agrandie ; retour sur le bouton d'origine à la fermeture
  useEffect(() => {
    const prev = document.activeElement;
    closeRef.current?.focus();
    return () => { if (prev && prev.isConnected) prev.focus?.(); };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Tab") {
        const btns = [...(boxRef.current?.querySelectorAll("button") || [])];
        if (!btns.length) return;
        e.preventDefault();
        const i = btns.indexOf(document.activeElement);
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);
  if (!url) return null;
  // boutons foncés : visibles même sur une photo à fond blanc (téléphone : flèches posées sur l'image) ; pétrole à 82 %,
  // icônes au trait, anneau de focus or clair (ex-on-dark), survol sarcelle (ex-btn-visionneuse)
  const nav = { position: "absolute", top: "50%", transform: "translateY(-50%)", color: T.paper, display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid rgba(251,248,242,0.35)", boxShadow: "0 2px 8px rgba(10,29,34,0.35)", borderRadius: R.pill, width: 44, height: 44, padding: 0, cursor: "pointer" };
  return (
    <div ref={boxRef} role="dialog" aria-modal="true" aria-label="Photo agrandie" onClick={onClose} className="ex-on-dark"
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,29,34,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img key={url} src={url} alt="" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()}
        onError={() => setBad(b => ({ ...b, [url]: true }))}
        onTouchStart={(e) => { tx.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (n > 1 && tx.current != null) { const dx = e.changedTouches[0].clientX - tx.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); } tx.current = null; }}
        style={{ maxWidth: "92vw", maxHeight: "86vh", objectFit: "contain", background: T.surface, borderRadius: R.s }} />
      <button ref={closeRef} className="ex-btn-visionneuse" onClick={onClose} aria-label="Fermer" style={{ ...nav, top: 14, right: 14, transform: "none" }}><Icone nom="fermer" taille={20} /></button>
      {n > 1 && <>
        <button className="ex-btn-visionneuse" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Photo précédente" style={{ ...nav, left: 10 }}><Icone nom="precedent" taille={22} /></button>
        <button className="ex-btn-visionneuse" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Photo suivante" style={{ ...nav, right: 10 }}><Icone nom="suivant" taille={22} /></button>
        <div className="num" style={{ position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center", color: T.paper, fontSize: 12, fontWeight: 600, opacity: 0.85 }}>{index + 1} / {n}</div>
      </>}
    </div>
  );
}

export default function ProductMedia({ media, title, onZoom }) {
  const [broken, setBroken] = useState({});   // src → image indisponible (masquée)
  const photos = (media?.photos || []).filter(p => !broken[p.src]);
  const video = media?.video || null;
  const highlights = (media?.highlights || []).filter(h => !broken[h.src]);
  // élément affiché : index de photo, ou "video"
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const hide = (src) => setBroken(b => ({ ...b, [src]: true }));
  if (!photos.length && !video && !highlights.length) return null;

  const showVideo = sel === "video" || (!photos.length && video);
  const cur = showVideo ? null : photos[Math.min(sel, photos.length - 1)];
  // vignettes : filet --line, pétrole sur la vignette affichée
  const thumb = (active) => ({ flexShrink: 0, width: 76, height: 54, borderRadius: R.s, overflow: "hidden", cursor: "pointer", padding: 0, position: "relative",
    border: `2px solid ${active ? T.petrol : T.line}`, background: T.surface });

  return (
    // Refonte charte (lot 7) : carte blanche (ui.card), titre en eyebrow pétrole, puits photo blanc (photos sur fond blanc),
    // icônes au trait ; vidéo chargée au clic seulement, comme avant
    <div style={ui.card}>
      <h2 style={{ ...ui.h2, display: "flex", alignItems: "center", gap: 8 }}>
        <Icone nom="image" taille={16} style={{ color: T.teal }} />
        <span>Photos{video ? " et vidéo" : ""}{title ? ` — ${title}` : ""}</span>
      </h2>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Visionneuse + vignettes */}
        <div style={{ flex: "1 1 340px", minWidth: 0, maxWidth: 560 }}>
          <div style={{ position: "relative", width: "100%", aspectRatio: "800 / 550", background: T.surface, borderRadius: 12, overflow: "hidden", border: `1px solid ${T.line}` }}>
            {showVideo ? (
              playing ? (
                <iframe title={video.title} src={`https://www.youtube-nocookie.com/embed/${video.youtube}?autoplay=1&rel=0&modestbranding=1`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
              ) : (
                <button onClick={() => setPlaying(true)} aria-label={`Lire la vidéo : ${video.title}`}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, padding: 0, cursor: "pointer", background: T.petrol }}>
                  <img src={ytThumb(video.youtube)} alt="" {...imgProps} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                  <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 64, height: 64, borderRadius: R.pill,
                    background: "rgba(15,45,61,0.88)", color: T.paper, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(10,29,34,0.35)" }}>
                    <Icone nom="lecture" taille={26} plein style={{ marginLeft: 3 }} />
                  </span>
                  <span style={{ position: "absolute", left: 12, bottom: 10, right: 12, color: "#fff", fontSize: 12, fontWeight: 700, textAlign: "left", textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>{video.title}</span>
                </button>
              )
            ) : cur ? (
              <button onClick={() => onZoom?.(photos, photos.indexOf(cur))} aria-label="Agrandir la photo"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, padding: 0, background: "transparent", cursor: "zoom-in" }}>
                <img src={cur.src} alt="" {...imgProps} onError={() => hide(cur.src)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                <span style={{ position: "absolute", right: 10, bottom: 10, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(15,45,61,0.82)", color: T.paper,
                  fontSize: 11, fontWeight: 700, borderRadius: R.pill, padding: "4px 10px 4px 8px" }}><Icone nom="agrandir" taille={13} epaisseur={2.4} />Agrandir</span>
              </button>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
            {photos.map((p, i) => (
              <button key={p.src} onClick={() => { setSel(i); setPlaying(false); }} aria-label={`Photo ${i + 1}`} aria-pressed={!showVideo && cur === p} style={thumb(!showVideo && cur === p)}>
                <img src={p.thumb || p.src} alt="" {...imgProps} onError={() => hide(p.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </button>
            ))}
            {video && (
              <button onClick={() => setSel("video")} aria-label="Vidéo" aria-pressed={!!showVideo} style={thumb(showVideo)}>
                <img src={ytThumb(video.youtube)} alt="" {...imgProps} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,45,61,0.35)", color: "#fff" }}>
                  <Icone nom="lecture" taille={18} plein />
                </span>
              </button>
            )}
          </div>
        </div>
        {/* Points forts */}
        {highlights.length > 0 && (
          <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMute, textTransform: "uppercase", letterSpacing: "0.06em" }}>Points forts</div>
            {highlights.map(h => (
              <div key={h.src} style={{ display: "flex", gap: 12, alignItems: "center", background: T.paper, borderRadius: R.s, padding: 8, border: `1px solid ${T.lineSoft}` }}>
                <button onClick={() => onZoom?.([{ src: h.src }], 0)} aria-label={`Agrandir : ${h.title}`}
                  style={{ flexShrink: 0, width: 96, height: 64, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.lineSoft}`, padding: 0, cursor: "zoom-in", background: T.surface }}>
                  <img src={h.src} alt="" {...imgProps} onError={() => hide(h.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{h.title}</div>
                  <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2, lineHeight: 1.4 }}>{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

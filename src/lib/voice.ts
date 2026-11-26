"use client";
// Voix de l'assistant, entièrement dans le navigateur (API Web Speech) :
// dictée (reconnaissance vocale) et lecture des réponses (synthèse vocale).
// Rien ne transite par le serveur de Carnet ; selon le navigateur, la
// reconnaissance peut passer par le service du fabricant (Google pour Chrome).
import { useCallback, useEffect, useRef, useState } from "react";

const LANG = "fr-FR";

// Types minimaux : l'API n'est pas dans lib.dom pour tous les navigateurs
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Micro refusé : autorise-le pour ce site dans les réglages du navigateur.",
  "service-not-allowed": "La dictée n'est pas disponible dans ce navigateur.",
  "audio-capture": "Aucun micro détecté.",
  network: "La dictée a besoin d'une connexion Internet.",
};

/**
 * Dictée : `start()` écoute jusqu'à la fin de la phrase (silence) ;
 * `onFinal(texte)` reçoit le texte complet, `interim` montre l'écoute en cours.
 */
export function useDictation(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const cancelled = useRef(false);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- détection côté navigateur après le premier rendu
    setSupported(!!recognitionCtor());
    return () => recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    stopSpeaking(); // ne pas se dicter sa propre réponse
    const rec = new Ctor();
    rec.lang = LANG;
    rec.continuous = false; // s'arrête seul au silence
    rec.interimResults = true;
    finalRef.current = "";
    cancelled.current = false;
    setError(null);
    setInterim("");
    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else partial += r[0].transcript;
      }
      setInterim((finalRef.current + partial).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(ERRORS[e.error] ?? `Dictée interrompue (${e.error}).`);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim("");
      const text = finalRef.current.trim();
      if (text && !cancelled.current) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setError("La dictée n'a pas pu démarrer.");
    }
  }, []);

  /** Termine l'écoute et garde ce qui a été dit. */
  const stop = useCallback(() => recRef.current?.stop(), []);
  /** Abandonne sans rien garder. */
  const cancel = useCallback(() => {
    cancelled.current = true;
    recRef.current?.abort();
  }, []);

  return { supported, listening, interim, error, start, stop, cancel };
}

// ---------- Lecture à voix haute ----------

export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Texte lisible : sans markdown, liens remplacés par leur libellé, URL nues retirées. */
export function speakable(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

let frenchVoice: SpeechSynthesisVoice | null | undefined;
function pickVoice(): SpeechSynthesisVoice | null {
  if (frenchVoice !== undefined && frenchVoice !== null) return frenchVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // pas encore chargées : voix par défaut de la langue
  const fr = voices.filter((v) => v.lang.toLowerCase().startsWith("fr"));
  // Les voix « naturelles » / Google sonnent mieux que les voix système de base
  frenchVoice =
    fr.find((v) => v.lang === LANG && /natural|google|online|neural/i.test(v.name)) ??
    fr.find((v) => v.lang === LANG) ??
    fr[0] ??
    null;
  return frenchVoice;
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** Lit le texte ; `onEnd` est appelé à la fin ou à l'interruption. */
export function speak(md: string, onEnd?: () => void) {
  if (!speechSupported()) return onEnd?.();
  const synth = window.speechSynthesis;
  synth.cancel();
  const text = speakable(md);
  if (!text) return onEnd?.();
  // Découpage par phrases : Chrome coupe les énoncés trop longs (~15 s)
  const parts = text.match(/[^.!?\n]+[.!?]*|\n+/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const voice = pickVoice();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = LANG;
    if (voice) u.voice = voice;
    if (i === parts.length - 1) {
      u.onend = () => onEnd?.();
      u.onerror = () => onEnd?.();
    }
    synth.speak(u);
  });
}

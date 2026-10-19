"""
local_ai.py — JARVIS yerel zekâ, konuşma ve dinleme modülü
==========================================================
* LLMClient : Ollama (/api/chat), OpenAI-uyumlu (LM Studio, OmniRoute, Hermes router, llama.cpp, vLLM)
              ve opsiyonel bulut (OpenAI, Anthropic, Gemini, Groq, OpenRouter).
* SpeechToText : faster-whisper ile tamamen cihaz üzerinde Türkçe STT, enerji tabanlı VAD ile kayıt.
* TextToSpeech : Piper TTS (yerel ONNX ses modeli) -> yoksa pyttsx3 (SAPI5) yedek.
                 Konuşurken ses seviyesini (RMS) callback ile yayınlar (Orb titreşimi için).
* JarvisBrain : sistem promptu, bağlam ve sohbet geçmişi.
"""
from __future__ import annotations

import io
import os
import logging
import queue
import re
import threading
import time
import wave
from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np
import requests

log = logging.getLogger("jarvis.ai")

LevelCB = Optional[Callable[[float], None]]


# --------------------------------------------------------------------------- #
# LLM
# --------------------------------------------------------------------------- #
@dataclass
class LLMClient:
    kind: str = "ollama"  # ollama | openai_compat | anthropic | gemini
    base_url: str = "http://localhost:11434"
    model: str = "qwen2.5-coder:14b"
    api_key: str = ""
    temperature: float = 0.3

    @classmethod
    def from_dict(cls, d: dict) -> "LLMClient":
        return cls(kind=d.get("kind", "ollama"), base_url=d.get("baseUrl") or d.get("base_url", "http://localhost:11434"),
                   model=d.get("model", "qwen2.5-coder:14b"), api_key=d.get("apiKey") or d.get("api_key", ""))

    def chat(self, messages: list[dict], timeout: int = 120) -> str:
        base = self.base_url.rstrip("/")
        if self.kind == "ollama":
            r = requests.post(f"{base}/api/chat", json={
                "model": self.model, "messages": messages, "stream": False,
                "options": {"temperature": self.temperature, "num_ctx": 16384},
            }, timeout=timeout)
            r.raise_for_status()
            return r.json()["message"]["content"]
        if self.kind == "anthropic":
            system = "\n".join(m["content"] for m in messages if m["role"] == "system")
            r = requests.post(f"{base}/v1/messages", headers={
                "x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json",
            }, json={"model": self.model, "max_tokens": 8192, "system": system,
                     "messages": [m for m in messages if m["role"] != "system"]}, timeout=timeout)
            r.raise_for_status()
            return "".join(c.get("text", "") for c in r.json()["content"])
        if self.kind == "gemini":
            system = "\n".join(m["content"] for m in messages if m["role"] == "system")
            body = {"contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                                 for m in messages if m["role"] != "system"]}
            if system:
                body["systemInstruction"] = {"parts": [{"text": system}]}
            r = requests.post(f"{base}/v1beta/models/{self.model}:generateContent?key={self.api_key}", json=body, timeout=timeout)
            r.raise_for_status()
            return "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
        # openai_compat
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        r = requests.post(f"{base}/chat/completions", headers=headers, json={
            "model": self.model, "messages": messages, "temperature": self.temperature,
        }, timeout=timeout)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

    def ping(self) -> bool:
        try:
            self.chat([{"role": "user", "content": "ping"}], timeout=15)
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("LLM erişilemedi (%s): %s", self.base_url, e)
            return False


# --------------------------------------------------------------------------- #
# STT — faster-whisper
# --------------------------------------------------------------------------- #
def _add_nvidia_dll_dirs() -> None:
    """Windows: pip ile kurulan NVIDIA kütüphanelerini (nvidia-cublas-cu12, nvidia-cudnn-cu12) DLL arama yoluna ekler."""
    if os.name != "nt":
        return
    import glob
    import site

    roots = list(getattr(site, "getsitepackages", lambda: [])()) + [getattr(site, "getusersitepackages", lambda: "")()]
    for r in roots:
        for d in glob.glob(os.path.join(r or "", "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
            except Exception:  # noqa: BLE001
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


GPU_HINT = ("GPU (CUDA 12) kütüphaneleri bulunamadı (cublas64_12.dll / cuDNN) → ses tanıma CPU'da çalışacak. "
            "GPU istiyorsanız: .venv\\Scripts\\pip install nvidia-cublas-cu12 \"nvidia-cudnn-cu12==9.*\"")


class SpeechToText:
    def __init__(self, model_size: str = "small", device: str = "auto", compute_type: str = "int8",
                 language: str = "tr", sample_rate: int = 16000, on_level: LevelCB = None) -> None:
        self.model_size = model_size
        self.compute_type = compute_type
        self.language = language
        self.sr = sample_rate
        self.on_level = on_level
        dev = (device or "auto").lower()
        if dev in ("auto", "cuda", "gpu"):
            _add_nvidia_dll_dirs()
            if dev == "auto":
                try:
                    import ctranslate2

                    dev = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
                except Exception:  # noqa: BLE001
                    dev = "cpu"
            else:
                dev = "cuda"
        self.device = dev
        self.model = self._load(dev)
        # GPU seçildiyse gerçek bir çözümleme ile dene: cuBLAS/cuDNN eksikse hata ancak burada çıkar -> CPU'ya geç
        if self.device == "cuda" and not self._warmup():
            log.warning(GPU_HINT)
            self.device = "cpu"
            self.model = self._load("cpu")
        log.info("Ses tanıma hazır: faster-whisper %s · %s", self.model_size, self.device.upper())

    def _load(self, dev: str):  # noqa: ANN202
        from faster_whisper import WhisperModel  # lazy import

        ct = self.compute_type
        if dev == "cpu" and "float16" in ct:
            ct = "int8"  # CPU float16 desteklemez
        log.info("faster-whisper yükleniyor: %s (%s/%s)", self.model_size, dev, ct)
        return WhisperModel(self.model_size, device=dev, compute_type=ct)

    def _warmup(self) -> bool:
        try:
            segs, _ = self.model.transcribe(np.zeros(self.sr, dtype=np.float32), language=self.language,
                                            beam_size=1, vad_filter=False, without_timestamps=True)
            list(segs)
            return True
        except Exception as e:  # noqa: BLE001
            log.debug("GPU denemesi başarısız: %s", e)
            return False

    def record(self, max_seconds: float = 8.0, silence_sec: float = 0.9, start_timeout: float = 6.0,
               threshold: float = 0.012) -> np.ndarray:
        """Konuşma başlayana kadar bekler, sessizlik algılanınca durur."""
        import sounddevice as sd

        q: "queue.Queue[np.ndarray]" = queue.Queue()

        def cb(indata, frames, t, status):  # noqa: ANN001
            q.put(indata[:, 0].copy())

        frames: list[np.ndarray] = []
        started = False
        silent_for = 0.0
        t0 = time.time()
        block = int(self.sr * 0.05)
        with sd.InputStream(samplerate=self.sr, channels=1, dtype="float32", blocksize=block, callback=cb):
            while True:
                try:
                    chunk = q.get(timeout=1)
                except queue.Empty:
                    continue
                rms = float(np.sqrt(np.mean(chunk ** 2)))
                if self.on_level:
                    self.on_level(min(1.0, rms * 12))
                if rms > threshold:
                    started = True
                    silent_for = 0.0
                elif started:
                    silent_for += len(chunk) / self.sr
                if started:
                    frames.append(chunk)
                elapsed = time.time() - t0
                if started and silent_for >= silence_sec:
                    break
                if not started and elapsed > start_timeout:
                    break
                if elapsed > max_seconds + start_timeout:
                    break
        if self.on_level:
            self.on_level(0.0)
        return np.concatenate(frames) if frames else np.zeros(0, dtype=np.float32)

    def transcribe(self, audio: np.ndarray) -> str:
        if audio.size < self.sr * 0.3:
            return ""
        def run() -> str:
            segments, _ = self.model.transcribe(audio, language=self.language, beam_size=1, vad_filter=True,
                                                initial_prompt="Jarvis, evet, hayır, işlem, parite, derle, durum.")
            return " ".join(s.text.strip() for s in segments).strip()

        try:
            return run()
        except RuntimeError as e:
            if self.device == "cpu":
                raise
            log.warning("%s (%s)", GPU_HINT, str(e)[:80])  # çalışırken GPU hatası -> CPU'ya geç, tekrar dene
            self.device = "cpu"
            self.model = self._load("cpu")
            return run()

    def listen(self, **kw) -> str:  # noqa: ANN003
        text = self.transcribe(self.record(**kw))
        log.info("🎙  '%s'", text)
        return text


# --------------------------------------------------------------------------- #
# TTS — Piper (yerel) / pyttsx3 yedek
# --------------------------------------------------------------------------- #
class TextToSpeech:
    def __init__(self, piper_model: Optional[str] = None, on_level: LevelCB = None, rate: int = 175) -> None:
        self.on_level = on_level
        self.voice = None
        self.engine = None
        self._lock = threading.Lock()
        if piper_model:
            try:
                from piper import PiperVoice  # piper-tts

                self.voice = PiperVoice.load(piper_model)
                log.info("Piper TTS yüklendi: %s", piper_model)
            except Exception as e:  # noqa: BLE001
                log.warning("Piper yüklenemedi (%s) -> pyttsx3", e)
        if self.voice is None:
            import pyttsx3

            self.engine = pyttsx3.init()
            self.engine.setProperty("rate", rate)
            for v in self.engine.getProperty("voices"):
                if "tr" in (v.id or "").lower() or "turk" in (v.name or "").lower():
                    self.engine.setProperty("voice", v.id)
                    break

    def _piper_pcm(self, text: str) -> tuple[np.ndarray, int]:
        v = self.voice
        # piper-tts >= 1.3: synthesize() AudioChunk üretir
        try:
            chunks = list(v.synthesize(text))
            if chunks and hasattr(chunks[0], "audio_int16_bytes"):
                sr = chunks[0].sample_rate
                pcm = np.frombuffer(b"".join(c.audio_int16_bytes for c in chunks), dtype=np.int16)
                return pcm, sr
        except TypeError:
            pass
        # piper-tts 1.2: synthesize(text, wav_file)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            v.synthesize(text, wf)
        buf.seek(0)
        with wave.open(buf, "rb") as wf:
            sr = wf.getframerate()
            pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
        return pcm, sr

    def say(self, text: str) -> None:
        text = re.sub(r"[*#`_>]", "", text).strip()
        if not text:
            return
        log.info("🔊 %s", text)
        with self._lock:
            if self.voice is not None:
                import sounddevice as sd

                pcm, sr = self._piper_pcm(text)
                audio = pcm.astype(np.float32) / 32768.0
                if self.on_level:  # konuşma ritmine göre seviye yayınla
                    win = int(sr * 0.05)
                    levels = [float(np.sqrt(np.mean(audio[i:i + win] ** 2))) for i in range(0, len(audio), win)]

                    def pump():
                        for lv in levels:
                            self.on_level(min(1.0, lv * 6))
                            time.sleep(0.05)
                        self.on_level(0.0)

                    threading.Thread(target=pump, daemon=True).start()
                sd.play(audio, sr)
                sd.wait()
            else:
                stop = threading.Event()
                if self.on_level:
                    def osc():
                        while not stop.is_set():
                            self.on_level(0.3 + np.random.rand() * 0.6)
                            time.sleep(0.07)
                        self.on_level(0.0)
                    threading.Thread(target=osc, daemon=True).start()
                self.engine.say(text)
                self.engine.runAndWait()
                stop.set()


# --------------------------------------------------------------------------- #
# Niyet yardımcıları (KESİN ONAY KURALI)
# --------------------------------------------------------------------------- #
def _norm(s: str) -> str:
    s = s.lower().replace("İ", "i").replace("I", "ı")
    return re.sub(r"[^\wçğıöşü ]+", " ", s).strip()


def is_yes(text: str) -> bool:
    t = _norm(text)
    if not t:
        return False
    if re.search(r"\b(hayır|hayir|değil|degil|yok|girme|iptal)\b", t):
        return False
    return bool(re.match(r"^(evet|evet\b.*|onaylıyorum|onayla|gir|işleme gir|aç)$", t))


def is_no(text: str) -> bool:
    return bool(re.search(r"\b(hayır|hayir|reddet|iptal|vazgeç|girme|istemiyorum|pas)\b", _norm(text)))


def has_wake_word(text: str, wake: str = "jarvis") -> bool:
    t = _norm(text)
    return wake in t or "carvis" in t or "jarviz" in t or "cervis" in t


# --------------------------------------------------------------------------- #
# Beyin
# --------------------------------------------------------------------------- #
SYSTEM_PROMPT = (
    "Sen JARVIS'sin: kullanıcının MetaTrader 5 algoritmik işlem ve MQL5 geliştirme asistanı. "
    "Türkçe, kısa (en fazla 3 cümle), saygılı ('efendim') ve net konuş; cevapların sesli okunacak, markdown kullanma. "
    "Kullanıcı açıkça 'evet' demeden asla işlem açma veya açtığını söyleme."
)


class JarvisBrain:
    def __init__(self, llm: LLMClient, max_history: int = 12) -> None:
        self.llm = llm
        self.history: list[dict] = []
        self.max_history = max_history

    def ask(self, text: str, context: str = "") -> str:
        self.history.append({"role": "user", "content": text})
        msgs = [{"role": "system", "content": SYSTEM_PROMPT + (f"\nGüncel bağlam: {context}" if context else "")}]
        msgs += self.history[-self.max_history:]
        try:
            reply = self.llm.chat(msgs, timeout=90).strip()
        except Exception as e:  # noqa: BLE001
            reply = f"Yerel zekâ çekirdeğine ulaşamıyorum efendim. {type(e).__name__}."
        self.history.append({"role": "assistant", "content": reply})
        return reply


if __name__ == "__main__":  # python local_ai.py  -> LLM + TTS + STT hızlı test
    logging.basicConfig(level=logging.INFO)
    llm = LLMClient()
    print("LLM:", llm.chat([{"role": "user", "content": "Tek cümleyle kendini tanıt."}]))
    tts = TextToSpeech()
    tts.say("Sistemler çevrimiçi efendim.")
    stt = SpeechToText("base")
    print("Duyulan:", stt.listen())

/**
 * Live 16kHz Mono PCM16 browser microphone streamer -> Dialogger WebSocket -> NeMo-Speech.cpp
 * Uses an inline AudioWorklet processor to downsample cleanly off the main thread.
 */

const WORKLET_SOURCE = `
class Pcm16DownsamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.prevSample = 0;
    this.buffer = [];
    this.targetChunkSamples = 2560; // 160ms at 16kHz (matches NeMo-Speech.cpp streaming chunk)
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    if (channel.length === 0) return true;

    // Compute RMS for UI meter
    let sumSq = 0;
    for (let i = 0; i < channel.length; i++) {
      sumSq += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sumSq / channel.length);

    // Phase-continuous linear downsampling to exact 16kHz across render blocks
    let pos = this.phase;
    while (pos < channel.length) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = idx < 0 ? this.prevSample : channel[idx];
      const s1 =
        idx + 1 < channel.length ? channel[idx + 1] : channel[channel.length - 1];
      const sample = s0 + (s1 - s0) * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.buffer.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      pos += this.ratio;
    }
    this.phase = pos - channel.length;
    this.prevSample = channel[channel.length - 1];

    while (this.buffer.length >= this.targetChunkSamples) {
      const pcm16 = new Int16Array(this.buffer.splice(0, this.targetChunkSamples));
      this.port.postMessage({ pcm16: pcm16.buffer, rms }, [pcm16.buffer]);
    }
    if (rms > 0.002) {
      this.port.postMessage({ rms });
    }
    return true;
  }
}
registerProcessor('pcm16-downsampler', Pcm16DownsamplerProcessor);
`;

export interface LiveMicController {
  stop: () => void;
}

export async function startLiveMicCapture(
  sessionId: string,
  callbacks: {
    onLevel?: (level: number) => void;
    onStatus?: (msg: string) => void;
    onError?: (err: string) => void;
    onClose?: () => void;
  }
): Promise<LiveMicController> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Browser microphone capture requires localhost or HTTPS. You can still upload any audio file, run the live demo, or push diarized turns via the Agent API."
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${window.location.host}/ws/sessions/${encodeURIComponent(sessionId)}/live`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  let workletNode: AudioWorkletNode | null = null;
  let workletUrl: string | null = null;
  let stopped = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try {
      workletNode?.disconnect();
      source.disconnect();
      void audioCtx.close();
    } catch {
      // ignore
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    if (workletUrl) {
      URL.revokeObjectURL(workletUrl);
      workletUrl = null;
    }
    // Close client WS cleanly; server sends a single final commit and awaits completion before closing upstream
    try {
      ws.close(1000, "mic_stopped");
    } catch {
      // ignore
    }
    callbacks.onLevel?.(0);
    callbacks.onClose?.();
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(String(evt.data)) as { type?: string; message?: string };
      if (msg.type === "live.ready" && msg.message) {
        callbacks.onStatus?.(msg.message);
      } else if (msg.type === "live.error" && msg.message) {
        callbacks.onError?.(msg.message);
      }
    } catch {
      // ignore
    }
  };

  ws.onerror = () => {
    callbacks.onError?.("WebSocket connection to local speech bridge failed.");
  };

  ws.onclose = () => {
    if (!stopped) cleanup();
  };

  try {
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    workletUrl = URL.createObjectURL(blob);
    await audioCtx.audioWorklet.addModule(workletUrl);
    workletNode = new AudioWorkletNode(audioCtx, "pcm16-downsampler");

    workletNode.port.onmessage = (evt: MessageEvent<{ pcm16?: ArrayBuffer; rms?: number }>) => {
      if (typeof evt.data.rms === "number") {
        callbacks.onLevel?.(Math.min(1, evt.data.rms * 4.5));
      }
      if (evt.data.pcm16 && ws.readyState === WebSocket.OPEN) {
        ws.send(evt.data.pcm16);
      }
    };

    source.connect(workletNode);
  } catch (err) {
    cleanup();
    throw err;
  }

  return { stop: cleanup };
}

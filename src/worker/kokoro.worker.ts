/// <reference lib="webworker" />

import { env as hfEnv } from "@huggingface/transformers";
import { KokoroModel } from "./model";
import { installModelCacheFetch } from "./modelCache";
import { Orchestrator } from "./orchestrator";
import type { VoiceId } from "./types";
import type { DeviceInfo, InMsg, LoadedDevice, OutMsg } from "./workerProtocol";
import { createHandlers } from "./workerProtocol";

// Injected as JSON via `new Worker(url, { name })`.
export interface KokoroWorkerConfig {
  installModelCacheFetch: boolean;
  ortWasm: {
    numThreads: number;
    proxy: boolean;
    // undefined overrides transformers.js's CDN default; forces bundled WASM.
    wasmPaths: string | undefined;
  };
}

const cfg = JSON.parse(self.name) as KokoroWorkerConfig;
if (cfg.installModelCacheFetch) installModelCacheFetch();
const ortWasm = hfEnv.backends.onnx.wasm!;
ortWasm.numThreads = cfg.ortWasm.numThreads;
ortWasm.proxy = cfg.ortWasm.proxy;
ortWasm.wasmPaths = cfg.ortWasm.wasmPaths;

export type { VoiceId } from "./types";
export type { InMsg, OutMsg } from "./workerProtocol";

function post(msg: OutMsg, transfer: Transferable[] = []): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

const SAMPLE_RATE = 24000;
const DEFAULT_VOICE: VoiceId = "af_heart";

interface GPUAdapterLike {
  features: { has: (name: string) => boolean } & Iterable<string>;
  info?: { description?: string; vendor?: string; architecture?: string };
  requestAdapterInfo?: () => Promise<{
    description?: string;
    vendor?: string;
    architecture?: string;
  }>;
}
interface AdapterRequester {
  requestAdapter: () => Promise<GPUAdapterLike | null>;
}

interface AdapterInfo {
  name: string;
  vendor: string;
  features: string[];
}

/** The WebGPU adapter's details, or null when the browser exposes no adapter. */
async function probeAdapter(): Promise<AdapterInfo | null> {
  const gpu = (navigator as unknown as { gpu?: AdapterRequester }).gpu;
  if (!gpu) return null;
  let adapter: GPUAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    return null;
  }
  if (!adapter) return null;
  let info: { description?: string; vendor?: string; architecture?: string } = {};
  if (adapter.info) info = adapter.info;
  else if (adapter.requestAdapterInfo) {
    try {
      info = await adapter.requestAdapterInfo();
    } catch {
      /* ignore */
    }
  }
  // Prefer architecture ("metal-3", "rdna-3", …) over the verbose description.
  const name = info.architecture || info.description || "";
  const features: string[] = [];
  try {
    for (const f of adapter.features) features.push(f);
  } catch {
    /* iteration unsupported */
  }
  return { name, vendor: info.vendor ?? "", features };
}

// `navigator.gpu` can exist with no adapter behind it (WebGPU blocklisted or
// unavailable); only a real adapter selects WebGPU, else ONNX runs on WASM.
const adapterProbe = probeAdapter();
const device: Promise<LoadedDevice> = adapterProbe.then((a) => (a ? "webgpu" : "wasm"));

const model = new KokoroModel({
  device,
  onProgress: (event) => {
    post({
      type: "progress",
      status: event.status,
      file: event.file,
      loaded: event.loaded,
      total: event.total,
    });
  },
});

async function load(): Promise<DeviceInfo> {
  const t0 = performance.now();
  const [, adapter] = await Promise.all([model.ensureLoaded(), adapterProbe]);
  return {
    device: adapter ? "webgpu" : "wasm",
    adapterName: adapter?.name ?? "",
    adapterVendor: adapter?.vendor ?? "",
    features: adapter?.features ?? [],
    sessionInitMs: performance.now() - t0,
  };
}

const handlers = createHandlers<VoiceId>({
  load,
  synthesizePcm: (text, voice) => model.generate(text, voice),
  createOrchestrator: () => new Orchestrator({ model, sampleRate: SAMPLE_RATE, post }),
  post: (msg, transfer = []) => post(msg, transfer),
  sampleRate: SAMPLE_RATE,
  defaultVoice: DEFAULT_VOICE,
});

self.addEventListener("message", (ev: MessageEvent<InMsg>) => {
  handlers.onMessage(ev.data);
});

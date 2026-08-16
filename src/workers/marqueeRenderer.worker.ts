interface MarqueeGeometry {
  direction: "left" | "right" | "up" | "down";
  distance: number;
  endX: number;
  endY: number;
  startX: number;
  startY: number;
}

interface ConfigureMessage {
  type: "configure";
  animationKey: string;
  backingHeight: number;
  backingWidth: number;
  canvasScale: number;
  contentHeight: number;
  contentWidth: number;
  direction: MarqueeGeometry["direction"];
  geometry: MarqueeGeometry;
  motionBlurEnabled: boolean;
  paused: boolean;
  pixelsPerSecond: number;
  texture: ImageBitmap;
  viewportHeight: number;
  viewportWidth: number;
}

type IncomingMessage =
  | { type: "init"; canvas: OffscreenCanvas }
  | ConfigureMessage
  | { type: "pause"; paused: boolean }
  | { type: "speed"; pixelsPerSecond: number };

interface RenderConfiguration extends Omit<ConfigureMessage, "texture" | "type"> {
  bitmap: ImageBitmap | null;
}

interface WebGlRenderer {
  alpha: WebGLUniformLocation;
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  position: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  size: WebGLUniformLocation;
  texture: WebGLTexture;
}

interface WorkerScope {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<IncomingMessage>) => void,
  ) => void;
  cancelAnimationFrame?: (handle: number) => void;
  postMessage: (message: unknown) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

const scope = globalThis as unknown as WorkerScope;
let canvas: OffscreenCanvas | null = null;
let configuration: RenderConfiguration | null = null;
let renderer: WebGlRenderer | OffscreenCanvasRenderingContext2D | null = null;
let rendererKind: "webgl" | "2d" | null = null;
let animationFrame: number | null = null;
let epochProgress = 0;
let epochTime = 0;
let activePixelsPerSecond = 0;
let paused = true;

function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

function progressAt(timestamp: number): number {
  if (!configuration || paused || configuration.geometry.distance <= 0) {
    return epochProgress;
  }
  return normalizeProgress(
    epochProgress +
      ((timestamp - epochTime) * activePixelsPerSecond) /
        (configuration.geometry.distance * 1_000),
  );
}

function freezeProgress(timestamp: number): void {
  epochProgress = progressAt(timestamp);
  epochTime = timestamp;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createWebGlRenderer(gl: WebGLRenderingContext): WebGlRenderer | null {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 a_unit;
      uniform vec2 u_resolution;
      uniform vec2 u_position;
      uniform vec2 u_size;
      varying vec2 v_texture;
      void main() {
        vec2 pixel = u_position + a_unit * u_size;
        vec2 clip = pixel / u_resolution * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        v_texture = a_unit;
      }
    `,
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      uniform sampler2D u_texture;
      uniform float u_alpha;
      varying vec2 v_texture;
      void main() {
        vec4 color = texture2D(u_texture, v_texture);
        gl_FragColor = color * u_alpha;
      }
    `,
  );
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const unitLocation = gl.getAttribLocation(program, "a_unit");
  const resolution = gl.getUniformLocation(program, "u_resolution");
  const position = gl.getUniformLocation(program, "u_position");
  const size = gl.getUniformLocation(program, "u_size");
  const alpha = gl.getUniformLocation(program, "u_alpha");
  const sampler = gl.getUniformLocation(program, "u_texture");
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (
    unitLocation < 0 ||
    !resolution ||
    !position ||
    !size ||
    !alpha ||
    !sampler ||
    !buffer ||
    !texture
  ) {
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      0, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 1,
    ]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(unitLocation);
  gl.vertexAttribPointer(unitLocation, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(sampler, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  return { alpha, buffer, gl, position, resolution, size, texture };
}

function initializeRenderer(): boolean {
  if (!canvas || !scope.requestAnimationFrame || !scope.cancelAnimationFrame) {
    return false;
  }
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  }) as WebGLRenderingContext | null;
  if (gl) {
    const webGlRenderer = createWebGlRenderer(gl);
    if (webGlRenderer) {
      renderer = webGlRenderer;
      rendererKind = "webgl";
      return true;
    }
    return false;
  }
  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
  }) as OffscreenCanvasRenderingContext2D | null;
  if (!context) return false;
  renderer = context;
  rendererKind = "2d";
  return true;
}

function isWebGlRenderer(
  value: WebGlRenderer | OffscreenCanvasRenderingContext2D,
): value is WebGlRenderer {
  return "gl" in value;
}

function uploadTexture(bitmap: ImageBitmap): void {
  if (!renderer || !isWebGlRenderer(renderer)) return;
  const { gl, texture } = renderer;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bitmap,
  );
}

function velocity(direction: MarqueeGeometry["direction"]): [number, number] {
  if (direction === "left") return [-1, 0];
  if (direction === "right") return [1, 0];
  if (direction === "up") return [0, -1];
  return [0, 1];
}

function drawWebGlCopy(
  webGl: WebGlRenderer,
  x: number,
  y: number,
  alpha: number,
): void {
  if (!configuration) return;
  const { gl } = webGl;
  gl.uniform2f(webGl.position, x, y);
  gl.uniform2f(
    webGl.size,
    configuration.contentWidth,
    configuration.contentHeight,
  );
  gl.uniform1f(webGl.alpha, alpha);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function draw2dCopy(
  context: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  alpha: number,
): void {
  if (!configuration) return;
  context.globalAlpha = alpha;
  context.drawImage(
    bitmap,
    x,
    y,
    configuration.contentWidth,
    configuration.contentHeight,
  );
}

function drawCopyWithTrail(
  x: number,
  y: number,
  direction: MarqueeGeometry["direction"],
): void {
  if (!renderer || !configuration) return;
  const [velocityX, velocityY] = velocity(direction);
  const trailDistance = configuration.motionBlurEnabled
    ? Math.min(5.5, Math.max(0, (activePixelsPerSecond - 120) / 96))
    : 0;
  const samples: Array<[number, number]> = trailDistance > 0
    ? [[1, 0.1], [0.66, 0.16], [0.33, 0.24], [0, 1]]
    : [[0, 1]];
  for (const [fraction, alpha] of samples) {
    const sampleX = x - velocityX * trailDistance * fraction;
    const sampleY = y - velocityY * trailDistance * fraction;
    if (isWebGlRenderer(renderer)) {
      drawWebGlCopy(renderer, sampleX, sampleY, alpha);
    } else if (configuration.bitmap) {
      draw2dCopy(renderer, configuration.bitmap, sampleX, sampleY, alpha);
    }
  }
}

function paint(timestamp: number): void {
  if (!canvas || !renderer || !configuration) return;
  const progress = progressAt(timestamp);
  const secondProgress = progress >= 0.5 ? progress - 0.5 : progress + 0.5;
  const { geometry } = configuration;
  const positionAt = (value: number) => ({
    x: geometry.startX + (geometry.endX - geometry.startX) * value,
    y: geometry.startY + (geometry.endY - geometry.startY) * value,
  });
  const primary = positionAt(progress);
  const secondary = positionAt(secondProgress);

  if (isWebGlRenderer(renderer)) {
    const { gl } = renderer;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(
      renderer.resolution,
      configuration.viewportWidth,
      configuration.viewportHeight,
    );
  } else {
    renderer.setTransform(1, 0, 0, 1, 0, 0);
    renderer.globalAlpha = 1;
    renderer.clearRect(0, 0, canvas.width, canvas.height);
    renderer.setTransform(
      configuration.canvasScale,
      0,
      0,
      configuration.canvasScale,
      0,
      0,
    );
  }
  drawCopyWithTrail(primary.x, primary.y, configuration.direction);
  drawCopyWithTrail(secondary.x, secondary.y, configuration.direction);
  if (!isWebGlRenderer(renderer)) renderer.globalAlpha = 1;
}

function cancelFrame(): void {
  if (animationFrame === null) return;
  scope.cancelAnimationFrame?.(animationFrame);
  animationFrame = null;
}

function drawFrame(timestamp: number): void {
  animationFrame = null;
  if (paused || !configuration) return;
  paint(timestamp);
  animationFrame = scope.requestAnimationFrame?.(drawFrame) ?? null;
}

function ensureFrame(): void {
  if (paused || !configuration || animationFrame !== null) return;
  animationFrame = scope.requestAnimationFrame?.(drawFrame) ?? null;
}

function configure(message: ConfigureMessage): void {
  if (!canvas || !renderer) {
    message.texture.close();
    return;
  }
  const timestamp = performance.now();
  const previousProgress = progressAt(timestamp);
  const sameAnimation = configuration?.animationKey === message.animationKey &&
    configuration.direction === message.direction;
  freezeProgress(timestamp);

  configuration?.bitmap?.close();
  canvas.width = message.backingWidth;
  canvas.height = message.backingHeight;
  if (isWebGlRenderer(renderer)) {
    uploadTexture(message.texture);
    message.texture.close();
  }
  configuration = {
    animationKey: message.animationKey,
    backingHeight: message.backingHeight,
    backingWidth: message.backingWidth,
    bitmap: isWebGlRenderer(renderer) ? null : message.texture,
    canvasScale: message.canvasScale,
    contentHeight: message.contentHeight,
    contentWidth: message.contentWidth,
    direction: message.direction,
    geometry: message.geometry,
    motionBlurEnabled: message.motionBlurEnabled,
    paused: message.paused,
    pixelsPerSecond: message.pixelsPerSecond,
    viewportHeight: message.viewportHeight,
    viewportWidth: message.viewportWidth,
  };
  epochProgress = sameAnimation ? previousProgress : 0;
  epochTime = timestamp;
  activePixelsPerSecond = message.pixelsPerSecond;
  paused = message.paused;
  paint(timestamp);
  if (paused) cancelFrame();
  else ensureFrame();
}

scope.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    canvas = message.canvas;
    if (!initializeRenderer()) {
      scope.postMessage({ type: "unsupported" });
      return;
    }
    scope.postMessage({ type: "ready", renderer: rendererKind });
    return;
  }
  if (message.type === "configure") {
    configure(message);
    return;
  }
  const timestamp = performance.now();
  if (message.type === "speed") {
    freezeProgress(timestamp);
    activePixelsPerSecond = Math.max(0, message.pixelsPerSecond);
    paint(timestamp);
    ensureFrame();
    return;
  }
  freezeProgress(timestamp);
  paused = message.paused;
  paint(timestamp);
  if (paused) cancelFrame();
  else ensureFrame();
});

export {};

"use client";

import { useEffect, useRef, useState } from "react";

interface PanoramaViewerProps {
  image: string;
  label: string;
  autoRotate: boolean;
  onReady?: () => void;
  onError?: () => void;
}

const VERTEX = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
// Ray per pixel from yaw/pitch/fov, sampled from an equirectangular photo.
const FRAGMENT = `precision highp float;
varying vec2 v; uniform sampler2D tex; uniform float yaw; uniform float pitch; uniform float fov; uniform float aspect;
const float PI = 3.14159265358979;
void main(){
  float t = tan(fov * 0.5);
  vec3 d = normalize(vec3(v.x * t * aspect, v.y * t, -1.0));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(yaw), sy = sin(yaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  gl_FragColor = texture2D(tex, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI));
}`;

const MIN_FOV = 0.6;
const MAX_FOV = 1.75;
const PITCH_LIMIT = 1.35;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

// Drag to look around, wheel/pinch-free zoom, slow drift. Falls back to a flat photo without WebGL.
export function PanoramaViewer({ image, label, autoRotate, onReady, onError }: PanoramaViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useRef({ yaw: 0, pitch: 0, fov: 1.3, dragging: false, lastX: 0, lastY: 0, idleUntil: 0 });
  const callbacks = useRef({ onReady, onError });
  const [fallback, setFallback] = useState(false);

  useEffect(() => { callbacks.current = { onReady, onError }; }, [onReady, onError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) { setFallback(true); return; }
    let disposed = false;
    let frame = 0;
    let texture: WebGLTexture | null = null;
    let program: WebGLProgram | null = null;
    const shaders: WebGLShader[] = [];
    const flat = () => {
      if (disposed) return;
      disposed = true;
      setFallback(true);
    };
    // Panoramas are 4096 wide; WebGL1 only guarantees 2048, so smaller GPUs get the flat photo.
    if (Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) < 4096) { flat(); return; }
    try {
      program = gl.createProgram();
      if (!program) throw new Error("program");
      shaders.push(compile(gl, gl.VERTEX_SHADER, VERTEX), compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
    } catch {
      if (program) gl.deleteProgram(program);
      flat();
      return;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = {
      yaw: gl.getUniformLocation(program, "yaw"),
      pitch: gl.getUniformLocation(program, "pitch"),
      fov: gl.getUniformLocation(program, "fov"),
      aspect: gl.getUniformLocation(program, "aspect"),
    };
    const picture = new Image();
    picture.decoding = "async";
    picture.onload = () => {
      if (disposed) return;
      texture = gl.createTexture();
      if (!texture) { flat(); return; }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, picture);
      if (gl.getError() !== gl.NO_ERROR) { flat(); return; }
      // No mipmaps: avoids a visible seam where longitude wraps.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      callbacks.current.onReady?.();
    };
    picture.onerror = () => { if (!disposed) callbacks.current.onError?.(); };
    picture.src = image;

    let last = performance.now();
    const draw = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const state = view.current;
      if (autoRotate && !state.dragging && now > state.idleUntil) state.yaw += dt * 0.035;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
      if (texture) {
        gl.uniform1f(uniforms.yaw, state.yaw);
        gl.uniform1f(uniforms.pitch, state.pitch);
        gl.uniform1f(uniforms.fov, state.fov);
        gl.uniform1f(uniforms.aspect, width / height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    // React onWheel is passive; attach natively so preventDefault stops page zoom/scroll.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = view.current;
      state.fov = Math.min(MAX_FOV, Math.max(MIN_FOV, state.fov * Math.exp(event.deltaY * 0.0012)));
      state.idleUntil = performance.now() + 4000;
    };
    const onLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); flat(); };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onLost);
      picture.onload = null;
      picture.onerror = null;
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
    };
  }, [image, autoRotate]);

  const look = (dx: number, dy: number) => {
    const state = view.current;
    const scale = state.fov / Math.max(1, canvasRef.current?.clientHeight ?? 600);
    state.yaw -= dx * scale;
    state.pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, state.pitch + dy * scale));
    state.idleUntil = performance.now() + 4000;
  };

  if (fallback) {
    // eslint-disable-next-line @next/next/no-img-element -- Local static panorama, load events drive readiness.
    return <img src={image} alt={label} className="absolute inset-0 size-full object-cover" onLoad={() => callbacks.current.onReady?.()} onError={() => callbacks.current.onError?.()} />;
  }
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${label} · 끌어서 둘러보기, 휠로 확대`}
      tabIndex={0}
      data-testid="healing-panorama"
      className="absolute inset-0 size-full cursor-grab touch-none outline-none active:cursor-grabbing"
      onPointerDown={(event) => {
        const state = view.current;
        state.dragging = true;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = view.current;
        if (!state.dragging) return;
        look(event.clientX - state.lastX, event.clientY - state.lastY);
        state.lastX = event.clientX;
        state.lastY = event.clientY;
      }}
      onPointerUp={() => { view.current.dragging = false; }}
      onPointerCancel={() => { view.current.dragging = false; }}
      onKeyDown={(event) => {
        const step = 40;
        if (event.key === "ArrowLeft") look(step, 0);
        else if (event.key === "ArrowRight") look(-step, 0);
        else if (event.key === "ArrowUp") look(0, step);
        else if (event.key === "ArrowDown") look(0, -step);
        else return;
        event.preventDefault();
      }}
    />
  );
}

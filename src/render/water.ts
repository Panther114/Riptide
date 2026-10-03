// WebGL ocean. A seamless wave height/normal texture is generated once on the
// CPU; the shader layers it at several scales and drift directions to build
// swell and chop, adds sun glint, cloud shadows and a vignette. Detail layers
// fade out with zoom to avoid shimmer. ~8 texture reads per pixel.

const VS = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }
`;

const FS = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uZoom;     // device px per metre
uniform float uTime;
uniform vec2 uWind;
uniform sampler2D uTex;  // rgb = normal (xy in rg), a = height

vec3 nrm(vec2 uv){ vec4 t = texture2D(uTex, uv); return vec3(t.rg*2.0-1.0, 1.0); }

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (frag - uRes*0.5)/uZoom;                 // metres relative to the camera
  vec2 c = uCenter;
  float t = uTime;
  float mpp = 1.0/uZoom;
  float detail = clamp(1.7 - log2(mpp+0.0001)*0.45, 0.0, 1.0);
  vec2 wd = normalize(uWind), wp = vec2(-wd.y, wd.x);
  // uv = (world)/scale; split centre into its own fract to keep precision
  #define UV(scale, drift) (fract(c/(scale)) + w/(scale) + (drift))
  vec3 n = vec3(0.0, 0.0, 1.0);
  vec3 n1 = nrm(UV(820.0, wd*t*0.0024));
  vec3 n2 = nrm(UV(530.0, (wp*0.6+wd)*t*0.0031) + 0.37);
  vec3 n3 = nrm(UV(140.0, wd*t*0.009) + 0.71);
  vec3 n4 = nrm(UV(47.0, -wp*t*0.018) + 0.13);
  n.xy = n1.xy*0.9 + n2.xy*0.7 + (n3.xy*0.7 + n4.xy*0.5*detail)*mix(0.25, 1.0, detail);
  n = normalize(vec3(n.xy*0.55, 1.0));
  float h = texture2D(uTex, UV(820.0, wd*t*0.0024)).a + texture2D(uTex, UV(530.0, (wp*0.6+wd)*t*0.0031) + 0.37).a;

  vec3 sun = normalize(vec3(-0.55, -0.62, 0.56));
  float diff = clamp(dot(n, sun), 0.0, 1.0);
  float big = texture2D(uTex, UV(26000.0, vec2(0.0)) + 0.5).a;
  vec3 deep = vec3(0.036, 0.142, 0.190);
  vec3 mid  = vec3(0.066, 0.240, 0.292);
  vec3 col = mix(deep, mid, smoothstep(0.3, 0.75, big));
  col *= 0.70 + diff*0.62;
  col += vec3(0.02, 0.05, 0.05) * (h - 1.0);
  vec3 r = reflect(-sun, n);
  float spec = pow(clamp(r.z, 0.0, 1.0), 80.0);
  col += vec3(0.85, 0.82, 0.70) * spec * 0.22 * (0.35 + detail*0.65);
  // sparse whitecaps on crests
  float cap = smoothstep(1.32, 1.6, h + texture2D(uTex, UV(90.0, wd*t*0.012)).a*0.5);
  col += vec3(0.55, 0.65, 0.68) * cap * 0.07 * detail * detail;
  // drifting cloud shadows
  float cl = texture2D(uTex, UV(9000.0, wd*t*0.00035) + 0.2).a;
  col *= 1.0 - smoothstep(0.5, 0.8, cl) * 0.26;
  vec2 sc = frag/uRes - 0.5;
  // broad sun glare from the upper left, vignette towards the corners
  col += vec3(0.05, 0.07, 0.07) * smoothstep(0.9, 0.0, length(sc - vec2(-0.45, -0.5)));
  col *= 1.0 - dot(sc*vec2(1.2,1.0), sc*vec2(1.2,1.0))*0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Seamless periodic value-noise fbm, returned as RGBA bytes (normal.xy, height). */
function makeWaveTexture(N = 256): Uint8Array {
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
  const octave = (period: number) => {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (x: number, y: number) => {
      const fx = (x / N) * period, fy = (y / N) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  const octs = [4, 8, 16, 32, 64].map(octave);
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, a = 0.55;
    for (const o of octs) { v += o(x, y) * a; a *= 0.5; }
    // sharpen crests a little (trochoid-ish)
    hgt[y * N + x] = Math.pow(v / 1.05, 1.35);
  }
  const out = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = (i: number, j: number) => hgt[((j + N) % N) * N + ((i + N) % N)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * 9, dy = (h(x, y + 1) - h(x, y - 1)) * 9;
    const i = (y * N + x) * 4;
    out[i] = Math.max(0, Math.min(255, (-dx * 0.5 + 0.5) * 255));
    out[i + 1] = Math.max(0, Math.min(255, (-dy * 0.5 + 0.5) * 255));
    out[i + 2] = 255;
    out[i + 3] = Math.max(0, Math.min(255, hgt[y * N + x] * 255));
  }
  return out;
}

export class Water {
  gl: WebGLRenderingContext | null;
  private prog: WebGLProgram | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  constructor(public canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', alpha: false });
    if (!this.gl) return;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    this.prog = p;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const u of ['uRes', 'uCenter', 'uZoom', 'uTime', 'uWind', 'uTex']) this.loc[u] = gl.getUniformLocation(p, u);
    const N = 256;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, makeWaveTexture(N));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  render(cx: number, cy: number, zoomDevice: number, time: number, wind: number) {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.uniform2f(this.loc.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.loc.uCenter, cx, cy);
    gl.uniform1f(this.loc.uZoom, zoomDevice);
    gl.uniform1f(this.loc.uTime, time % 20000);
    gl.uniform2f(this.loc.uWind, Math.cos(wind), Math.sin(wind));
    gl.uniform1i(this.loc.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

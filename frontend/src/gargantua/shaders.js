/**
 * Gargantua 黑洞着色器（逐字提取自 gargantua.html 的 <script type="x-shader/...">）
 *
 * 顶点着色器只负责铺满全屏的两个三角形；所有引力透镜、吸积盘、星场都在片元里算。
 * 两段都**不含反引号与 ${}**，因此可以安全地放进模板字面量、无需转义。
 */

export const VERTEX_SHADER = `attribute vec2 aPosition;void main(){gl_Position=vec4(aPosition,0.,1.);}`

export const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform float uWarp;
uniform float uMobile;
uniform float uEnergy;
#define PI 3.141592653589793

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float valueNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x),
                 mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x),
                 mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x),f.y),f.z);
}
float diskTexture(float r, float a) {
  // Differential rotation stretches irregular clouds into hot spiral filaments.
  float phase = a - uTime * .58 / pow(max(r, 1.0), 1.28);
  phase += .11 * sin(r * 1.35 - uTime * .025);
  vec3 flow = vec3(r * 4.8, cos(phase) * 7.0, sin(phase) * 7.0);
  float broad = valueNoise(flow * vec3(.38, .65, .65));
  float curls = valueNoise(flow + broad * 2.6);
  float fine = valueNoise(flow * vec3(3.1, 1.7, 1.7) + curls * 2.0);
  float threads = pow(max(.0, 1.0 - abs(fine * 2.0 - 1.0)), 7.0);
  return (.26 + broad * .66 + curls * .38) * (.55 + .85 * threads);
}
vec3 thermal(float r) {
  float hot = exp(-max(r - 2.0, 0.0) * .18);
  return mix(vec3(1.0, .39, .12), vec3(1.0, .91, .76), hot);
}
vec3 diskEmission(vec3 hit, vec2 screen) {
  float r = length(hit.xz);
  float edge = smoothstep(1.92, 2.55, r) * (1.0 - smoothstep(8.5, 12.5, r));
  float a = atan(hit.z, hit.x);
  float falloff = pow(2.8 / max(r, 2.8), 1.9);
  float turbul = diskTexture(r, a);
  float doppler = clamp(1.0 - .34 * hit.x / max(r, 1.0), .55, 1.4);
  // The lower, higher-order image loses energy on its longer optical path.
  float lowerImage = mix(.075, 1.0, smoothstep(-.18, -.055, screen.y));
  float attenuation = lowerImage;
  float energy = edge * falloff * turbul * doppler * attenuation;
  return thermal(r) * energy * 5.8;
}
vec3 stars(vec3 direction) {
  vec2 sphere = vec2(atan(direction.z, direction.x) / (2.0 * PI),
                     asin(clamp(direction.y, -1.0, 1.0)) / PI);
  vec3 result = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float scale = 380.0 + float(layer) * 270.0;
    vec2 g = sphere * scale;
    vec2 cell = floor(g), f = fract(g) - .5;
    float h = hash21(cell + 19.0 + float(layer) * 51.0);
    vec2 offset = vec2(hash21(cell + 7.3), hash21(cell + 39.1)) - .5;
    float dist = length(f - offset * .72);
    float pin = exp(-dist * dist * (620.0 + h * 1600.0));
    float active = smoothstep(.991, 1.0, h);
    vec3 temperature = mix(vec3(.69, .78, 1.0), vec3(1.0, .88, .71), hash21(cell - 8.0));
    result += pin * active * temperature * (.16 + .52 * h);
  }
  float nebula = valueNoise(direction * 7.0 + vec3(7.1, 19.2, 3.0));
  float band = exp(-abs(direction.y + direction.x * .28) * 11.0);
  result += vec3(.018, .014, .012) * pow(nebula, 3.0) * band;
  return result;
}
vec3 filmic(vec3 x) {
  return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0.0, 1.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 center = vec2(.52, mix(.56, .60, uMobile));
  float fit = min(1.0, aspect * 1.385);
  float zoom = 1.39 * fit * (1.0 + .24 * uWarp);
  vec2 screen = (uv - center) * vec2(aspect, 1.0);
  screen -= uPointer * .004 * fit;
  float roll = -.028 + sin(uTime * .024) * .002;
  screen = vec2(cos(roll) * screen.x - sin(roll) * screen.y,
                sin(roll) * screen.x + cos(roll) * screen.y);

  // Near edge-on camera; all dimensions below are in Schwarzschild radii.
  vec3 eye = vec3(0.0, .36 + uPointer.y * .035, -14.0);
  vec3 forward = normalize(-eye);
  vec3 right = vec3(1,0,0);
  vec3 up = normalize(cross(forward, right));
  vec3 ray = normalize(forward * zoom + screen.x * right + screen.y * up);
  vec3 position = eye;
  float angularMomentum2 = dot(cross(position, ray), cross(position, ray));
  vec3 radiation = vec3(0.0);
  vec3 atmosphere = vec3(0.0);
  float transmission = 1.0;
  float closest = 30.0;
  float captured = 0.0;
  float direct = 0.0;

  // Leapfrog integration bends null rays, exposing the far side above the hole.
  // Only plane crossings evaluate procedural matter; empty space stays cheap.
  for (int stepIndex = 0; stepIndex < 100; stepIndex++) {
    float r = length(position);
    closest = min(closest, r);
    float ds = clamp(r * .14, .055, .90);
    float invR = 1.0 / max(r, .8);
    vec3 acceleration = -1.5 * angularMomentum2 * position * pow(invR, 5.0);
    vec3 halfRay = ray + acceleration * (ds * .5);
    vec3 nextPosition = position + halfRay * ds;
    float nextR = length(nextPosition);
    float invNextR = 1.0 / max(nextR, .8);
    vec3 nextAcceleration = -1.5 * angularMomentum2 * nextPosition * pow(invNextR, 5.0);
    ray = halfRay + nextAcceleration * (ds * .5);

    if (position.y * nextPosition.y < 0.0) {
      float fraction = position.y / (position.y - nextPosition.y);
      vec3 hit = mix(position, nextPosition, fraction);
      float diskR = length(hit.xz);
      if (diskR > 1.92 && diskR < 17.0) {
        vec3 emission = diskEmission(hit, screen / fit);
        radiation += transmission * emission;
        float opacity = smoothstep(1.92, 2.55, diskR) * (1.0 - smoothstep(8.5, 12.5, diskR));
        transmission *= 1.0 - .94 * opacity;
        direct += opacity;
      }
    }
    if (r > 2.0 && r < 15.0) {
      float thickness = .11 + r * .012;
      float density = exp(-abs(position.y) / thickness);
      float radial = pow(2.8 / max(r, 2.8), 2.8) * smoothstep(2.0, 2.8, r);
      atmosphere += transmission * thermal(r) * density * radial * ds * .055;
    }
    position = nextPosition;
    if (nextR < 1.04) { captured = 1.0; break; }
    if (nextR > 28.0 && dot(position, ray) > 0.0) { break; }
  }

  vec3 color = radiation;
  if (captured < .5) color += stars(normalize(ray)) * transmission;
  color += atmosphere * mix(1.0, min(direct, 1.0), captured);

  // The film bloom is bounded outside the shadow; the event horizon stays black.
  float shadowRadius = .259 * fit * (1.0 + .24 * uWarp);
  float d = length(screen);
  float outsideShadow = smoothstep(shadowRadius * .97, shadowRadius * 1.02, d);
  float broadHalo = exp(-abs(d - shadowRadius * 1.22) / (.080 * fit));
  float upper = mix(.15, 1.0, smoothstep(-.025 * fit, .15 * fit, screen.y));
  float diskHalo = exp(-abs(screen.y + .009 * fit) / (.028 * fit));
  diskHalo *= exp(-abs(screen.x) / (.85 * fit));
  vec3 bloom = vec3(1.0, .61, .28) * (.105 * broadHalo * upper + .27 * diskHalo);
  color += bloom * max(outsideShadow, min(direct, 1.0) * .32);
  color *= 1.0 + uEnergy * .12;
  color = filmic(color * 1.13);
  color = pow(max(color, vec3(0)), vec3(.96));
  float vignette = 1.0 - .30 * smoothstep(.24, .86, length((uv - .5) * vec2(.83, 1.0)));
  color *= vignette;
  // Dither is limited to illuminated pixels, preserving an optically black core.
  color += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - .5) / 255.0 * smoothstep(.004, .06, max(color.r, max(color.g, color.b)));
  gl_FragColor = vec4(max(color, vec3(0)), 1.0);
}
`

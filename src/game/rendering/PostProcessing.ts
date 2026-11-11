import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Filmic grade applied in linear HDR before tone mapping. */
const GradeShader = {
  name: 'DriftlineGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.08 },
    vignette: { value: 0.42 },
    warmth: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float vignette;
    uniform vec3 warmth;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D( tDiffuse, vUv );
      float luminance = dot( color.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      color.rgb = mix( vec3( luminance ), color.rgb, saturation ) * warmth;
      vec2 offset = vUv - 0.5;
      color.rgb *= 1.0 - dot( offset, offset ) * vignette;
      gl_FragColor = color;
    }
  `,
};

/**
 * Nitro "warp": a zoom blur that smears the picture outward from the
 * vanishing point, strongest at the edges and absent in the centre, with
 * the colours splitting apart the further out it goes.
 */
const SpeedBlurShader = {
  name: 'NitroSpeedBlur',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0 },
    center: { value: new THREE.Vector2(0.5, 0.56) },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 center;
    varying vec2 vUv;
    const int SAMPLES = 18;
    void main() {
      vec2 toEdge = vUv - center;
      float radius = length( toEdge * vec2( 1.0, 0.75 ) );
      // Sharp in the middle where the driver looks, smeared toward the edges.
      float mask = smoothstep( 0.08, 0.62, radius );
      vec2 stride = toEdge * strength * mask / float( SAMPLES );
      float split = 0.18 * mask;
      vec3 sum = vec3( 0.0 );
      float weight = 0.0;
      for ( int i = 0; i < SAMPLES; i++ ) {
        float t = float( i );
        float w = 1.0 - t / float( SAMPLES ) * 0.5;
        vec2 uv = vUv - stride * t;
        sum.r += texture2D( tDiffuse, uv - stride * t * split ).r * w;
        sum.g += texture2D( tDiffuse, uv ).g * w;
        sum.b += texture2D( tDiffuse, uv + stride * t * split ).b * w;
        weight += w;
      }
      vec3 color = sum / weight;
      // The edges also darken and cool, like tunnel vision at speed.
      color *= 1.0 - mask * mask * strength * 1.4;
      color.b *= 1.0 + mask * strength * 0.6;
      gl_FragColor = vec4( color, 1.0 );
    }
  `,
};

/**
 * HDR pipeline for medium/high quality: MSAA scene render, bloom on emissive
 * lights and the sun, a light filmic grade, then tone mapping in OutputPass.
 */
export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly speedBlur: ShaderPass;
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    renderer.getDrawingBufferSize(this.size);
    const target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // Only true highlights bloom (sun, lamps, glints): a lower threshold lets
    // the bright sky bloom too, which veils the whole picture in milky haze.
    this.bloom = new UnrealBloomPass(this.size.clone(), 0.28, 0.6, 1.1);
    this.composer.addPass(this.bloom);
    this.speedBlur = new ShaderPass(SpeedBlurShader);
    this.speedBlur.enabled = false;
    this.composer.addPass(this.speedBlur);
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
  }

  /** Mirrors the viewport size and the renderer's pixel ratio onto every pass target. */
  syncSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(Math.max(1, width), Math.max(1, height));
  }

  /** Nitro edge blur, 0 (off) to about 0.3 (violent). */
  setSpeedBlur(strength: number): void {
    this.speedBlur.enabled = strength > 0.002;
    this.speedBlur.uniforms.strength.value = strength;
  }

  /** Low quality borrows this pipeline only for the nitro blur, so it skips the bloom. */
  setBloomEnabled(enabled: boolean): void {
    this.bloom.enabled = enabled;
  }

  render(deltaSeconds: number): void {
    this.composer.render(deltaSeconds);
  }

  dispose(): void {
    this.bloom.dispose();
    this.composer.dispose();
  }
}

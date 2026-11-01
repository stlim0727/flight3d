import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/environment/Terrain.js';
import { TerrainTextures } from '../src/environment/TerrainTextures.js';

test('Terrain & PBR Texture Splatting System', async (t) => {
  await t.test('CRITICAL CONTRACT: getHeight(x, z) analytical precision and repeatability', () => {
    const terrain = new Terrain(20000, 64);

    // 1. Center of airport mesa must be exactly 12.0m
    const centerH = terrain.getHeight(0, 0);
    assert.equal(Math.abs(centerH - 12.0) < 1e-6, true, `Airport center height should be 12.0m, got ${centerH}`);

    // 2. Runway corridor clearance (-3000m on extended centerline Z=0)
    const corridorH = terrain.getHeight(-3000, 0);
    assert.equal(Math.abs(corridorH - 12.0) < 1e-4, true, `Corridor height should be flat 12.0m, got ${corridorH}`);

    // 3. Repeatability: multiple calls with same coordinates must yield identical height
    const h1 = terrain.getHeight(2500, -3500);
    const h2 = terrain.getHeight(2500, -3500);
    assert.equal(h1, h2, 'getHeight must be 100% deterministic and repeatable');

    // 4. Perimeter edge falloff: drops smoothly to -18m for water blending
    const edgeH = terrain.getHeight(10500, 10500);
    assert.equal(edgeH < -10.0, true, `Perimeter edge should submerge below sea level, got ${edgeH}`);

    // 5. South ocean bay versus North mountain ridges
    const southBayH = terrain.getHeight(0, 5000);
    const northMountainH = terrain.getHeight(0, -5000);
    assert.equal(northMountainH > southBayH, true, 'North should have elevated mountain ranges relative to South ocean bay');
  });

  await t.test('TerrainTextures: PBR texture pack generation and specifications', () => {
    const textures = TerrainTextures.getTextures();
    const requiredKeys = [
      'grassMap', 'grassNormal',
      'sandMap', 'sandNormal',
      'rockMap', 'rockNormal',
      'snowMap', 'snowNormal',
      'runwayMap', 'runwayNormal',
      'microNormal'
    ];

    for (const key of requiredKeys) {
      assert.ok(textures[key], `Texture ${key} should be defined`);
      assert.ok(textures[key].isDataTexture, `Texture ${key} should be a THREE.DataTexture`);
      assert.equal(textures[key].wrapS, THREE.RepeatWrapping, `${key} wrapS should be RepeatWrapping`);
      assert.equal(textures[key].wrapT, THREE.RepeatWrapping, `${key} wrapT should be RepeatWrapping`);
      assert.equal(textures[key].generateMipmaps, true, `${key} generateMipmaps should be true`);
      assert.equal(textures[key].minFilter, THREE.LinearMipmapLinearFilter, `${key} minFilter should be LinearMipmapLinearFilter`);
      assert.equal(textures[key].magFilter, THREE.LinearFilter, `${key} magFilter should be LinearFilter`);
    }

    // Color spaces: albedo maps must be SRGBColorSpace, normal maps must be NoColorSpace
    const albedoKeys = ['grassMap', 'sandMap', 'rockMap', 'snowMap', 'runwayMap'];
    const normalKeys = ['grassNormal', 'sandNormal', 'rockNormal', 'snowNormal', 'runwayNormal', 'microNormal'];

    for (const key of albedoKeys) {
      assert.equal(textures[key].colorSpace, THREE.SRGBColorSpace, `${key} colorSpace should be SRGBColorSpace`);
    }
    for (const key of normalKeys) {
      assert.equal(textures[key].colorSpace, THREE.NoColorSpace, `${key} colorSpace should be NoColorSpace (linear)`);
    }

    // High-resolution allocation: grass and rock at 512x512
    assert.equal(textures.grassMap.image.width, 512);
    assert.equal(textures.grassMap.image.height, 512);
    assert.equal(textures.rockMap.image.width, 512);
    assert.equal(textures.rockMap.image.height, 512);

    // Total memory footprint must be under 10MB
    let totalBytes = 0;
    for (const key of requiredKeys) {
      const tex = textures[key];
      totalBytes += tex.image.width * tex.image.height * 4;
    }
    const totalMB = totalBytes / (1024 * 1024);
    assert.equal(totalMB < 10.0, true, `Total texture memory footprint (${totalMB.toFixed(2)} MB) must be under 10 MB`);
  });

  await t.test('Terrain: Mesh initialization and world geometry alignment', () => {
    const terrain = new Terrain(4000, 32);

    assert.ok(terrain.mesh, 'Terrain mesh should be created');
    assert.ok(terrain.geometry, 'Terrain geometry should be created');
    assert.ok(terrain.material, 'Terrain material should be created');
    assert.equal(terrain.mesh.receiveShadow, true, 'Terrain mesh should receive shadows');

    const pos = terrain.geometry.attributes.position;
    assert.ok(pos, 'Position attribute must exist');

    // Verify vertex heights match analytical getHeight
    for (let i = 0; i < Math.min(20, pos.count); i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = pos.getY(i);
      const expectedY = terrain.getHeight(x, z);
      assert.equal(Math.abs(y - expectedY) < 1e-4, true, `Vertex ${i} height must match analytical getHeight`);
    }
  });

  await t.test('Terrain: Shader onBeforeCompile injection and triplanar mapping logic', () => {
    const terrain = new Terrain(4000, 16);
    const mat = terrain.material;

    // Simulate Three.js shader compilation setup
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms)
    };

    mat.onBeforeCompile(shader);

    // 1. Verify uniforms are properly registered
    const expectedUniforms = [
      'uGrassMap', 'uGrassNormal',
      'uSandMap', 'uSandNormal',
      'uRockMap', 'uRockNormal',
      'uSnowMap', 'uSnowNormal',
      'uRunwayMap', 'uRunwayNormal',
      'uMicroNormal',
      'uAirportCenter', 'uAirportSize', 'uAirportBlendMargin',
      'uGrassScale', 'uSandScale', 'uRockScale', 'uSnowScale', 'uRunwayScale', 'uMicroScale',
      'uNormalStrength', 'uMicroStrength', 'uTriplanarSharpness'
    ];

    for (const u of expectedUniforms) {
      assert.ok(shader.uniforms[u] !== undefined, `Shader uniform ${u} should be defined`);
    }

    // 2. Vertex Shader: World-space coordinates and normal exported as varyings
    assert.ok(shader.vertexShader.includes('varying vec3 vTerrainWorldPos;'), 'Vertex shader should export vTerrainWorldPos');
    assert.ok(shader.vertexShader.includes('varying vec3 vTerrainWorldNormal;'), 'Vertex shader should export vTerrainWorldNormal');
    assert.ok(shader.vertexShader.includes('vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'), 'World pos calculation present in vertex shader');

    // 3. Fragment Shader: Triplanar Mapping, Slope Cliff Detection, and Micro Normal
    assert.ok(shader.fragmentShader.includes('vTerrainWorldPos'), 'Fragment shader should receive vTerrainWorldPos');
    assert.ok(shader.fragmentShader.includes('slopeCliff'), 'Fragment shader should calculate slopeCliff factor');
    assert.ok(shader.fragmentShader.includes('uTriplanarSharpness'), 'Fragment shader should use triplanar sharpness');
    assert.ok(shader.fragmentShader.includes('triWeight'), 'Fragment shader should compute triplanar projection weights');
    assert.ok(shader.fragmentShader.includes('uMicroNormal'), 'Fragment shader should sample micro-detail normal map');
    assert.ok(shader.fragmentShader.includes('microFade'), 'Fragment shader should blend micro-detail based on camera distance');

    // 4. Physical Material output overrides: Albedo, Roughness, Metalness, Normal
    assert.ok(shader.fragmentShader.includes('diffuseColor.rgb = tFinalAlbedo;'), 'Fragment shader should set diffuseColor to PBR splat albedo');
    assert.ok(shader.fragmentShader.includes('roughnessFactor = tFinalRoughness;'), 'Fragment shader should set roughnessFactor');
    assert.ok(shader.fragmentShader.includes('metalnessFactor = tFinalMetalness;'), 'Fragment shader should set metalnessFactor');
    assert.ok(shader.fragmentShader.includes('normal = transformDirection(tFinalWorldNormal, viewMatrix);'), 'Fragment shader should transform world normal into view space');
  });

  await t.test('Quality Presets: High, Low, and UltraLow modes', () => {
    const terrain = new Terrain(4000, 16, { quality: 'high' });
    assert.equal(terrain.getQuality(), 'high');
    assert.equal(terrain.material.defines.QUALITY_LOW, 0);

    terrain.setQuality('low');
    assert.equal(terrain.getQuality(), 'low');
    assert.equal(terrain.material.defines.QUALITY_LOW, 1);
    assert.equal(terrain.material.defines.QUALITY_ULTRALOW, 0);

    terrain.setQuality('ultraLow');
    assert.equal(terrain.getQuality(), 'ultraLow');
    assert.equal(terrain.material.defines.QUALITY_ULTRALOW, 1);
    assert.equal(terrain.segments, 64);
    assert.equal(terrain.mesh.receiveShadow, false);

    terrain.setQuality('high');
    assert.equal(terrain.getQuality(), 'high');
    assert.equal(terrain.material.defines.QUALITY_LOW, 0);
    assert.equal(terrain.material.defines.QUALITY_ULTRALOW, 0);
    assert.equal(terrain.mesh.receiveShadow, true);

    assert.throws(() => {
      terrain.setQuality('ultra');
    }, /Invalid quality preset/);
  });

  await t.test('Live parameter tuning methods', () => {
    const terrain = new Terrain(4000, 16);

    // Mock onBeforeCompile call to attach uniforms
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms)
    };
    terrain.material.onBeforeCompile(shader);

    terrain.setNormalStrength(1.2);
    assert.equal(terrain.normalStrength, 1.2);
    assert.equal(terrain.shaderUniforms.uNormalStrength.value, 1.2);

    terrain.setMicroStrength(0.6);
    assert.equal(terrain.microStrength, 0.6);
    assert.equal(terrain.shaderUniforms.uMicroStrength.value, 0.6);

    terrain.setTriplanarSharpness(8.0);
    assert.equal(terrain.triplanarSharpness, 8.0);
    assert.equal(terrain.shaderUniforms.uTriplanarSharpness.value, 8.0);
  });
});

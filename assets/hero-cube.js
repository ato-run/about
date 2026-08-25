// Hero background: a slowly rotating, floating field of cubes.
// Ported from ato-web's HeroThreeAnimation.tsx (Three.js), without the
// GSAP assemble intro — the perpetual rotate + float is the background effect.
import * as THREE from "./vendor/three.module.min.js";

(() => {
  const container = document.querySelector(".hero-cube");
  if (!container) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const config = {
    blockCount: 100,
    baseColor: 0x14181f,
    fogColor: 0xf6f7f9,
    cubeSpacing: 0.8,
    blockSize: 0.52,
    offsetY: 2.6,
    floatAmplitude: reducedMotion ? 0.06 : 0.15,
    rotateSpeed: reducedMotion ? 0.05 : 0.15,
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    return;
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (start, end, t) => start + (end - start) * t;

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(config.fogColor, 15, 60);

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 1000);
  camera.position.set(20, 20, 20);
  camera.lookAt(scene.position);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.3));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(10, 20, 10);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xcceeff, 0.5);
  fillLight.position.set(-10, 5, -10);
  scene.add(fillLight);

  const geometry = new THREE.BoxGeometry(config.blockSize, config.blockSize, config.blockSize);
  const material = new THREE.MeshPhongMaterial({
    color: config.baseColor,
    shininess: 60,
    specular: 0x444444,
  });

  const group = new THREE.Group();
  scene.add(group);

  const gridX = 5;
  const gridY = 4;
  const gridZ = Math.ceil(config.blockCount / (gridX * gridY));
  const offsetX = ((gridX - 1) * config.cubeSpacing) / 2;
  const offsetY = ((gridY - 1) * config.cubeSpacing) / 2;
  const offsetZ = ((gridZ - 1) * config.cubeSpacing) / 2;

  for (let i = 0; i < config.blockCount; i += 1) {
    let temp = i;
    const x = (temp % gridX) * config.cubeSpacing - offsetX;
    temp = Math.floor(temp / gridX);
    const y = (temp % gridY) * config.cubeSpacing - offsetY;
    temp = Math.floor(temp / gridY);
    const z = temp * config.cubeSpacing - offsetZ;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }

  const cameraUp = new THREE.Vector3();
  const composedOffset = new THREE.Vector3();

  const updateSize = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const aspect = width / height;
    const responsiveT = clamp((width - 720) / 560, 0, 1);
    const cameraDistance = lerp(12, 16, responsiveT);
    const pixelRatioCap = lerp(1.2, 1.5, responsiveT);

    camera.left = -cameraDistance * aspect;
    camera.right = cameraDistance * aspect;
    camera.top = cameraDistance;
    camera.bottom = -cameraDistance;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = `${width}px`;
    renderer.domElement.style.height = `${height}px`;
    group.scale.setScalar(lerp(0.78, 1.0, responsiveT));
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  };

  updateSize();
  window.addEventListener("resize", updateSize);
  if ("ResizeObserver" in window) {
    new ResizeObserver(updateSize).observe(container);
  }

  const clock = new THREE.Clock();
  const animate = () => {
    requestAnimationFrame(animate);
    if (container.clientWidth < 2 || container.clientHeight < 2) return;

    const time = clock.getElapsedTime();
    group.rotation.y = time * config.rotateSpeed;
    composedOffset
      .copy(cameraUp)
      .multiplyScalar(config.offsetY + Math.sin(time) * config.floatAmplitude);
    group.position.copy(composedOffset);
    renderer.render(scene, camera);
  };

  animate();
})();

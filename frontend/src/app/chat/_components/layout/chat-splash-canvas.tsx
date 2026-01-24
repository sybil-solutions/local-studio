"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store";

// Simplified splash canvas for chat-v2
// Full animation code from original component

type SplashFiber = {
  x: number;
  y: number;
  length: number;
  angle: number;
  alpha: number;
};

type SplashPoint = {
  x: number;
  y: number;
  ringIndex: number;
  pointIndex: number;
  angle: number;
  baseAngle: number;
  radius: number;
};

type SplashLine = {
  from: SplashPoint;
  to: SplashPoint;
  ringIndex: number;
};

type SplashGeometry = {
  rings: SplashPoint[][];
  radialLines: SplashLine[];
  connections: SplashLine[];
  ringCount: number;
  clearRadius: number;
};

const splashPalette = {
  base: "hsl(30, 5%, 10.5%)",
  ink: "hsla(268, 55%, 68%, 0.85)",
  inkFaint: "hsla(270, 35%, 58%, 0.3)",
  glow: "hsla(268, 60%, 62%, 0.55)",
  warmPulse: "hsla(275, 65%, 70%, 0.9)",
  highlight: "hsla(268, 70%, 75%, 0.8)",
  highlightBright: "hsla(265, 75%, 82%, 0.95)",
  highlightSubtle: "hsla(270, 50%, 62%, 0.4)",
};

const CYCLE_MS = 6500;

const envelopeValue = (value: number) => Math.sin(value * Math.PI);

const getClearRadius = (width: number, height: number) => {
  if (width < 640) return width * 0.26;
  return Math.min(width, height) * 0.1;
};

const buildFibers = (width: number, height: number): SplashFiber[] => {
  const fiberCount = Math.round(Math.min(width, height) / 60);
  const fibers: SplashFiber[] = [];
  for (let i = 0; i < fiberCount; i++) {
    fibers.push({
      x: Math.random() * width,
      y: Math.random() * height,
      length: 0.08 * width + Math.random() * 0.16 * width,
      angle: -0.35 + Math.random() * 0.7,
      alpha: 0.02 + Math.random() * 0.04,
    });
  }
  return fibers;
};

const buildGeometry = (width: number, height: number): SplashGeometry => {
  const centerX = width / 2;
  const centerY = height / 2;
  const clearRadius = getClearRadius(width, height);
  const diagonal = Math.sqrt(centerX * centerX + centerY * centerY);
  const ringCount = 16;
  const minRadius = clearRadius * 2.5;
  const maxRadius = diagonal * 1.15;
  const swirl = 0.75;
  const rings: SplashPoint[][] = [];
  const radialLines: SplashLine[] = [];
  const connections: SplashLine[] = [];

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
    const ringPosition = ringIndex / (ringCount - 1);
    const ringRadius = minRadius + (maxRadius - minRadius) * ringPosition;
    const pointsInRing = Math.floor(8 + ringIndex * 5);
    const ringRotation = (ringIndex % 2) * (Math.PI / pointsInRing) * 0.5;
    const ringPoints: SplashPoint[] = [];

    for (let pointIndex = 0; pointIndex < pointsInRing; pointIndex++) {
      const baseAngle = (pointIndex / pointsInRing) * Math.PI * 2 + ringRotation;
      const wobble = Math.sin(baseAngle * 3 + ringIndex * 1.2) * swirl * 8;
      const angle = baseAngle + Math.sin(ringRadius * 0.015 + ringIndex) * swirl * 0.2;
      const positionX = centerX + Math.cos(angle) * (ringRadius + wobble);
      const positionY = centerY + Math.sin(angle) * (ringRadius + wobble);

      ringPoints.push({
        x: positionX,
        y: positionY,
        ringIndex,
        pointIndex,
        angle,
        baseAngle,
        radius: ringRadius,
      });
    }
    rings.push(ringPoints);
  }

  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex++) {
    const innerRing = rings[ringIndex];
    const outerRing = rings[ringIndex + 1];

    innerRing.forEach((innerPoint) => {
      const distances = outerRing.map((outerPoint, outerIndex) => ({
        point: outerPoint,
        index: outerIndex,
        distance: Math.sqrt(
          (outerPoint.x - innerPoint.x) ** 2 + (outerPoint.y - innerPoint.y) ** 2,
        ),
      }));
      distances.sort((a, b) => a.distance - b.distance);
      if (!distances[0]) return;
      radialLines.push({ from: innerPoint, to: distances[0].point, ringIndex });
      if (distances[1] && distances[1].distance < distances[0].distance * 1.8) {
        radialLines.push({ from: innerPoint, to: distances[1].point, ringIndex });
      }
    });
  }

  rings.forEach((ringPoints, ringIndex) => {
    ringPoints.forEach((point, pointIndex) => {
      const nextPoint = ringPoints[(pointIndex + 1) % ringPoints.length];
      connections.push({ from: point, to: nextPoint, ringIndex });
    });
  });

  return { rings, radialLines, connections, ringCount, clearRadius };
};

const drawPaper = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fibers: SplashFiber[],
) => {
  ctx.fillStyle = splashPalette.base;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.strokeStyle = splashPalette.inkFaint;
  fibers.forEach((fiber) => {
    ctx.globalAlpha = fiber.alpha;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(fiber.x, fiber.y);
    ctx.lineTo(
      fiber.x + Math.cos(fiber.angle) * fiber.length,
      fiber.y + Math.sin(fiber.angle) * fiber.length,
    );
    ctx.stroke();
  });
  ctx.restore();
};

const drawCenterDisc = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
) => {
  ctx.save();
  const glowGradient = ctx.createRadialGradient(
    centerX,
    centerY,
    radius * 0.8,
    centerX,
    centerY,
    radius * 1.8,
  );
  glowGradient.addColorStop(0, "hsla(270, 40%, 50%, 0.15)");
  glowGradient.addColorStop(0.5, "hsla(270, 30%, 40%, 0.08)");
  glowGradient.addColorStop(1, "transparent");
  ctx.fillStyle = glowGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 1.1);
  gradient.addColorStop(0, "hsl(30, 5%, 10.5%)");
  gradient.addColorStop(0.7, "hsl(30, 5%, 10.5%)");
  gradient.addColorStop(1, "hsla(30, 5%, 10.5%, 0.95)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "hsla(270, 50%, 70%, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

const drawRings = (ctx: CanvasRenderingContext2D, geometry: SplashGeometry, timeValue: number) => {
  const ringCount = geometry.rings.length || geometry.ringCount;
  if (!ringCount) return;

  const alphaValue = envelopeValue(timeValue);
  const baseAlpha = alphaValue * 0.5 + 0.35;
  const wavePrimary = timeValue * Math.PI * 2 * 4;
  const waveSecondary = timeValue * Math.PI * 2 * 6;
  const waveTertiary = timeValue * Math.PI * 2 * 0.7;

  const getEdgeAlpha = (ringIndex: number) => {
    const edgeFactor = ringIndex / ringCount;
    const curved = edgeFactor * edgeFactor * edgeFactor;
    return 0.02 + curved * 1.3;
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Ring outlines
  geometry.rings.forEach((ringPoints, ringIndex) => {
    const edgeAlpha = getEdgeAlpha(ringIndex);
    const glowIntensity = Math.sin(wavePrimary - ringIndex * 0.6) * 0.3 + 0.6;
    ctx.globalAlpha = baseAlpha * 0.25 * glowIntensity * edgeAlpha;
    ctx.strokeStyle = splashPalette.highlightSubtle;
    ctx.lineWidth = 5 + edgeAlpha * 3;
    ctx.beginPath();
    ringPoints.forEach((point, pointIndex) => {
      if (pointIndex === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();
  });

  // Radial lines
  geometry.radialLines.forEach((line) => {
    const edgeAlpha = getEdgeAlpha(line.ringIndex);
    const pulsePosition = (wavePrimary / (Math.PI * 2) + line.from.baseAngle / (Math.PI * 2)) % 1;
    const pulseIntensity = Math.sin(pulsePosition * Math.PI * 2) * 0.5 + 0.5;

    ctx.globalAlpha = baseAlpha * 0.35 * pulseIntensity * edgeAlpha;
    ctx.strokeStyle = splashPalette.glow;
    ctx.lineWidth = 1.5 + edgeAlpha;
    ctx.beginPath();
    ctx.moveTo(line.from.x, line.from.y);
    ctx.lineTo(line.to.x, line.to.y);
    ctx.stroke();

    ctx.globalAlpha = baseAlpha * (0.45 + pulseIntensity * 0.35) * edgeAlpha;
    ctx.strokeStyle = splashPalette.ink;
    ctx.lineWidth = 0.8 + pulseIntensity * 0.5 + edgeAlpha * 0.3;
    ctx.beginPath();
    ctx.moveTo(line.from.x, line.from.y);
    ctx.lineTo(line.to.x, line.to.y);
    ctx.stroke();
  });

  // Connections
  geometry.connections.forEach((connection) => {
    const edgeAlpha = getEdgeAlpha(connection.ringIndex);
    const waveValue =
      Math.sin(wavePrimary - connection.ringIndex * 0.7) * 0.5 +
      Math.sin(waveSecondary - connection.ringIndex * 1.1 + connection.from.pointIndex * 0.4) * 0.3;
    const intensity = (waveValue + 0.8) / 1.6;

    ctx.globalAlpha = baseAlpha * 0.4 * intensity * edgeAlpha;
    ctx.strokeStyle = splashPalette.glow;
    ctx.lineWidth = 1.5 + intensity * 1.2 + edgeAlpha;
    ctx.beginPath();
    ctx.moveTo(connection.from.x, connection.from.y);
    ctx.lineTo(connection.to.x, connection.to.y);
    ctx.stroke();

    ctx.globalAlpha = baseAlpha * (0.5 + intensity * 0.35) * edgeAlpha;
    ctx.strokeStyle = splashPalette.ink;
    ctx.lineWidth = 0.7 + intensity * 0.5 + edgeAlpha * 0.3;
    ctx.beginPath();
    ctx.moveTo(connection.from.x, connection.from.y);
    ctx.lineTo(connection.to.x, connection.to.y);
    ctx.stroke();
  });

  // Nodes
  geometry.rings.forEach((ringPoints, ringIndex) => {
    const edgeAlpha = getEdgeAlpha(ringIndex);
    ringPoints.forEach((point, pointIndex) => {
      const nodePulse =
        Math.sin(wavePrimary - ringIndex * 0.5 + pointIndex * 0.4) * 0.5 +
        Math.sin(waveSecondary - ringIndex * 0.8 + pointIndex * 0.6) * 0.3;
      const intensity = (nodePulse + 0.8) / 1.6;
      const nodeSize = 1.2 + intensity * 1.8 + edgeAlpha * 0.5;

      ctx.globalAlpha = baseAlpha * 0.45 * intensity * edgeAlpha;
      ctx.fillStyle = splashPalette.glow;
      ctx.beginPath();
      ctx.arc(point.x, point.y, nodeSize + 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = baseAlpha * (0.55 + intensity * 0.35) * edgeAlpha;
      ctx.fillStyle = splashPalette.ink;
      ctx.beginPath();
      ctx.arc(point.x, point.y, nodeSize, 0, Math.PI * 2);
      ctx.fill();

      if (intensity > 0.6 && edgeAlpha > 0.3) {
        ctx.globalAlpha = baseAlpha * 0.7 * ((intensity - 0.6) / 0.4) * edgeAlpha;
        ctx.fillStyle = splashPalette.highlightBright;
        ctx.beginPath();
        ctx.arc(point.x, point.y, nodeSize * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });

  // Traveling particles
  const particleCount = 12;
  for (let i = 0; i < particleCount; i++) {
    const particleProgress = (timeValue * 0.6 + i / particleCount) % 1;
    const particleRingIndex = Math.floor(ringCount * 0.4 + particleProgress * ringCount * 0.55);
    const ringPoints = geometry.rings[particleRingIndex];
    if (!ringPoints || ringPoints.length === 0) continue;

    const particleAngle = (waveTertiary + (i * Math.PI * 2) / particleCount) % (Math.PI * 2);
    const nearestPoint = ringPoints.reduce(
      (best, point) => {
        const diff = Math.abs(point.angle - particleAngle);
        return diff < best.diff ? { point, diff } : best;
      },
      { diff: Infinity, point: ringPoints[0] },
    );

    if (nearestPoint.point) {
      const particleEdgeAlpha = getEdgeAlpha(particleRingIndex);
      ctx.globalAlpha = baseAlpha * 0.6 * envelopeValue(particleProgress) * particleEdgeAlpha;
      ctx.fillStyle = splashPalette.warmPulse;
      ctx.beginPath();
      ctx.arc(nearestPoint.point.x, nearestPoint.point.y, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = baseAlpha * 0.8 * envelopeValue(particleProgress) * particleEdgeAlpha;
      ctx.fillStyle = splashPalette.highlightBright;
      ctx.beginPath();
      ctx.arc(nearestPoint.point.x, nearestPoint.point.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
};

export function ChatSplashCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useAppStore((state) => state.splashIsMobile);
  const setIsMobile = useAppStore((state) => state.setSplashIsMobile);

  useEffect(() => {
    // Check if mobile on mount and resize
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [setIsMobile]);

  useEffect(() => {
    // Skip canvas animation on mobile
    if (isMobile) return;

    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrame: number | null = null;
    const startTime = performance.now();
    let canvasScale = 1;
    let fibers: SplashFiber[] = [];
    let geometry = buildGeometry(1, 1);
    let lastWidth = 0;
    let lastHeight = 0;
    let lastScale = 1;

    const resize = () => {
      const width = Math.max(wrapper.clientWidth, 1);
      const height = Math.max(wrapper.clientHeight, 1);
      const nextScale = Math.min(window.devicePixelRatio || 1, 2);

      if (width === lastWidth && height === lastHeight && Math.abs(nextScale - lastScale) < 0.01) {
        return;
      }

      lastWidth = width;
      lastHeight = height;
      lastScale = nextScale;
      canvasScale = nextScale;
      canvas.width = width * canvasScale;
      canvas.height = height * canvasScale;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
      fibers = buildFibers(width, height);
      geometry = buildGeometry(width, height);
    };

    resize();
    if (!geometry.rings.length) return;

    const animate = (time: number) => {
      const width = canvas.width / canvasScale;
      const height = canvas.height / canvasScale;
      const cycleProgress = ((time - startTime) % CYCLE_MS) / CYCLE_MS;
      drawPaper(ctx, width, height, fibers);
      if (geometry) {
        drawRings(ctx, geometry, cycleProgress);
        drawCenterDisc(ctx, width / 2, height / 2, geometry.clearRadius);
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    const observer = new ResizeObserver(() => resize());
    observer.observe(wrapper);
    window.addEventListener("resize", resize);
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [isMobile]);

  // No splash on mobile
  if (isMobile) {
    return null;
  }

  return (
    <div
      ref={wrapperRef}
      className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,hsla(30,8%,10%,0.92),hsla(30,8%,10%,0.7)_35%,transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[hsla(30,5%,10.5%,0.28)]" />
    </div>
  );
}

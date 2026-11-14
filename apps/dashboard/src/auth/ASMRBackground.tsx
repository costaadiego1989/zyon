import React, { useEffect, useRef } from "react";

/**
 * ASMR Static Background — particle system with magnetic vortex effect.
 * Adapted from Tailwind to vanilla CSS for AACP dashboard.
 */
export function ASMRBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width: number;
    let height: number;
    let animationFrameId: number;
    let particles: Particle[] = [];
    const mouse = { x: -1000, y: -1000 };

    const PARTICLE_COUNT = 800;
    const MAGNETIC_RADIUS = 280;
    const VORTEX_STRENGTH = 0.07;
    const PULL_STRENGTH = 0.12;

    class Particle {
      x = 0; y = 0; vx = 0; vy = 0;
      size = 0; alpha = 0; color = "";
      rotation = 0; rotationSpeed = 0; frictionGlow = 0;

      constructor() { this.reset(); }

      reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.size = Math.random() * 1.5 + 0.5;
        this.vx = (Math.random() - 0.5) * 0.2;
        this.vy = (Math.random() - 0.5) * 0.2;
        const isGlass = Math.random() > 0.7;
        this.color = isGlass ? "240, 245, 255" : "80, 80, 85";
        this.alpha = Math.random() * 0.4 + 0.1;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.05;
      }

      update() {
        const dx = mouse.x - this.x;
        const dy = mouse.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < MAGNETIC_RADIUS) {
          const force = (MAGNETIC_RADIUS - dist) / MAGNETIC_RADIUS;
          this.vx += (dx / dist) * force * PULL_STRENGTH;
          this.vy += (dy / dist) * force * PULL_STRENGTH;
          this.vx += (dy / dist) * force * VORTEX_STRENGTH * 10;
          this.vy -= (dx / dist) * force * VORTEX_STRENGTH * 10;
          this.frictionGlow = force * 0.7;
        } else {
          this.frictionGlow *= 0.92;
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.95;
        this.vy *= 0.95;
        this.vx += (Math.random() - 0.5) * 0.04;
        this.vy += (Math.random() - 0.5) * 0.04;
        this.rotation += this.rotationSpeed + (Math.abs(this.vx) + Math.abs(this.vy)) * 0.05;

        if (this.x < -20) this.x = width + 20;
        if (this.x > width + 20) this.x = -20;
        if (this.y < -20) this.y = height + 20;
        if (this.y > height + 20) this.y = -20;
      }

      draw() {
        if (!ctx) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        const finalAlpha = Math.min(this.alpha + this.frictionGlow, 0.9);
        ctx.fillStyle = `rgba(${this.color}, ${finalAlpha})`;
        if (this.frictionGlow > 0.3) {
          ctx.shadowBlur = 8 * this.frictionGlow;
          ctx.shadowColor = `rgba(180, 220, 255, ${this.frictionGlow})`;
        }
        ctx.beginPath();
        ctx.moveTo(0, -this.size * 2.5);
        ctx.lineTo(this.size, 0);
        ctx.lineTo(0, this.size * 2.5);
        ctx.lineTo(-this.size, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    const init = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
    };

    const render = () => {
      ctx.fillStyle = "rgba(10, 10, 12, 0.10)";
      ctx.fillRect(0, 0, width, height);
      particles.forEach((p) => { p.update(); p.draw(); });
      animationFrameId = requestAnimationFrame(render);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };

    const handleResize = () => init();

    canvas.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("resize", handleResize);
    init();
    render();

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}

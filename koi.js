/* ASCII koi pond.
 * Each fish is a chain of joints (follow-the-leader), drawn as a smooth
 * body onto a hidden low-res canvas, then sampled per character cell and
 * converted to coloured glyphs.
 */
(() => {
	const pond = document.getElementById("pond");
	if (!pond) return;

	const RAMP = " .`,:;~-+=*#%$@";
	const SS = 2; // canvas pixels per character cell (each axis)
	const FPS = 30;
	const JOINTS = 18;
	const MAX_BEND = 0.12; // radians per joint
	const TAU = Math.PI * 2;
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
	const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
	const rand = (a, b) => a + Math.random() * (b - a);

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d", { willReadFrequently: true });

	let W = 0, H = 0, cw = 6, ch = 9, cols = 0, rows = 0;
	let fish = [];
	const mouse = { x: -9999, y: -9999 };

	/* ---------- varieties ---------- */
	const WHITE = "#f3f4f6", RED = "#e3342f", ORANGE = "#f59e0b", BLACK = "#111111", GOLD = "#fbbf24";

	function makePattern() {
		const kind = Math.random();
		const patches = [];
		if (kind < 0.4) {
			// kohaku: white with red patches
			const n = 2 + Math.floor(Math.random() * 3);
			for (let i = 0; i < n; i++) patches.push({ u: rand(0.05, 0.75), side: rand(-0.7, 0.7), size: rand(0.6, 1.3), color: RED });
			return { base: WHITE, patches };
		}
		if (kind < 0.6) {
			// showa / sanke: white, red and black
			for (let i = 0; i < 3; i++) patches.push({ u: rand(0.05, 0.7), side: rand(-0.6, 0.6), size: rand(0.6, 1.2), color: RED });
			for (let i = 0; i < 4; i++) patches.push({ u: rand(0.15, 0.85), side: rand(-0.9, 0.9), size: rand(0.25, 0.55), color: BLACK });
			return { base: WHITE, patches };
		}
		if (kind < 0.75) {
			// tancho: white with a single red spot on the head
			patches.push({ u: 0.07, side: 0, size: 0.75, color: RED });
			return { base: WHITE, patches };
		}
		if (kind < 0.9) {
			// ogon: solid gold/orange
			patches.push({ u: 0.3, side: 0, size: 0.6, color: GOLD });
			return { base: ORANGE, patches };
		}
		// orange with white patches
		for (let i = 0; i < 3; i++) patches.push({ u: rand(0.1, 0.8), side: rand(-0.8, 0.8), size: rand(0.5, 1), color: WHITE });
		return { base: ORANGE, patches };
	}

	/* ---------- layout ---------- */
	function measure() {
		const probe = document.createElement("span");
		probe.textContent = "0".repeat(50);
		probe.style.visibility = "hidden";
		pond.appendChild(probe);
		const r = probe.getBoundingClientRect();
		cw = r.width / 50 || 6;
		ch = r.height || 9;
		pond.removeChild(probe);

		W = window.innerWidth;
		H = window.innerHeight;
		cols = Math.ceil(W / cw);
		rows = Math.ceil(H / ch);
		canvas.width = cols * SS;
		canvas.height = rows * SS;
	}

	function contentRect() {
		const main = document.querySelector("main");
		return main ? main.getBoundingClientRect() : null;
	}

	function pickTarget(f) {
		const m = 60;
		const rect = contentRect();
		for (let i = 0; i < 8; i++) {
			const x = rand(m, W - m), y = rand(m, H - m);
			// prefer open water beside the text, unless the screen is too narrow
			if (rect && W > 900 && x > rect.left - 40 && x < rect.right + 40 && Math.random() < 0.85) continue;
			f.tx = x; f.ty = y;
			return;
		}
		f.tx = rand(m, W - m); f.ty = rand(m, H - m);
	}

	function makeFish() {
		const scale = clamp(W / 1100, 0.55, 1);
		const L = rand(190, 270) * scale;
		const heading = rand(0, TAU);
		const rect = contentRect();
		let x = rand(0.1, 0.9) * W, y = rand(0.1, 0.9) * H;
		if (rect && W > 900 && x < rect.right) x = rand(rect.right + 40, W - 60);
		const seg = L / (JOINTS - 1);
		const pts = [];
		for (let i = 0; i < JOINTS; i++) pts.push({ x: x - Math.cos(heading) * seg * i, y: y - Math.sin(heading) * seg * i });
		const f = {
			L, seg, pts, heading,
			speed: rand(25, 40), cruise: rand(28, 48),
			phase: rand(0, TAU),
			pattern: makePattern(),
			tx: 0, ty: 0,
		};
		pickTarget(f);
		return f;
	}

	function spawn() {
		const n = clamp(Math.round((W * H) / 260000), 3, 7);
		fish = Array.from({ length: n }, makeFish);
	}

	/* ---------- simulation ---------- */
	function step(f, dt) {
		const head = f.pts[0];
		let dx = f.tx - head.x, dy = f.ty - head.y;
		if (dx * dx + dy * dy < 70 * 70) { pickTarget(f); dx = f.tx - head.x; dy = f.ty - head.y; }

		let desired = Math.atan2(dy, dx);
		let wantSpeed = f.cruise;

		// shy of the cursor
		const mx = head.x - mouse.x, my = head.y - mouse.y;
		const md = Math.hypot(mx, my);
		if (md < 140) { desired = Math.atan2(my, mx); wantSpeed = f.cruise * 2.6; }

		// give other fish some room
		for (const o of fish) {
			if (o === f) continue;
			const ox = head.x - o.pts[0].x, oy = head.y - o.pts[0].y;
			const od = Math.hypot(ox, oy);
			if (od > 0 && od < f.L * 0.6) desired += wrapAngle(Math.atan2(oy, ox) - desired) * 0.25;
		}

		const turn = 0.8 * dt * (wantSpeed > f.cruise ? 2 : 1);
		f.heading += clamp(wrapAngle(desired - f.heading), -turn, turn);
		f.speed += (wantSpeed - f.speed) * (1 - Math.exp(-2 * dt));

		f.phase += dt * (2.5 + f.speed * 0.07);
		const swim = f.heading + Math.sin(f.phase) * 0.3;
		head.x += Math.cos(swim) * f.speed * dt;
		head.y += Math.sin(swim) * f.speed * dt;

		// follow the leader, with a limit on how sharply each joint can bend
		let prevAngle = Math.atan2(-Math.sin(f.heading), -Math.cos(f.heading));
		for (let i = 1; i < f.pts.length; i++) {
			const a = f.pts[i - 1], b = f.pts[i];
			let ang = Math.atan2(b.y - a.y, b.x - a.x);
			ang = prevAngle + clamp(wrapAngle(ang - prevAngle), -MAX_BEND, MAX_BEND);
			b.x = a.x + Math.cos(ang) * f.seg;
			b.y = a.y + Math.sin(ang) * f.seg;
			prevAngle = ang;
		}
	}

	/* ---------- drawing ---------- */
	function width(u) {
		if (u < 0.1) return 0.55 + 0.45 * Math.sqrt(u / 0.1);
		if (u < 0.33) return 1;
		return 1 - 0.85 * smooth((u - 0.33) / 0.67);
	}

	function frameOf(f) {
		const n = f.pts.length, maxR = f.L * 0.14;
		const out = [];
		for (let i = 0; i < n; i++) {
			const p = f.pts[i];
			const a = f.pts[Math.max(0, i - 1)], b = f.pts[Math.min(n - 1, i + 1)];
			let tx = a.x - b.x, ty = a.y - b.y;
			const d = Math.hypot(tx, ty) || 1;
			tx /= d; ty /= d; // points towards the head
			out.push({ x: p.x, y: p.y, tx, ty, nx: -ty, ny: tx, r: maxR * width(i / (n - 1)) });
		}
		return out;
	}

	function at(fr, u) {
		const i = clamp(Math.round(u * (fr.length - 1)), 0, fr.length - 1);
		return fr[i];
	}

	function drawFin(x, y, angle, len, wid, color, alpha) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle);
		ctx.globalAlpha = alpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.ellipse(len / 2, 0, len / 2, wid / 2, 0, 0, TAU);
		ctx.fill();
		ctx.restore();
	}

	function drawFish(f, t) {
		const fr = frameOf(f);
		const finColor = f.pattern.base === ORANGE ? "#fcd34d" : "#e5e7eb";

		// pectoral fins
		const pf = at(fr, 0.22);
		const flap = Math.sin(t * 3 + f.phase) * 0.25;
		const back = Math.atan2(-pf.ty, -pf.tx);
		for (const s of [-1, 1]) {
			drawFin(pf.x + pf.nx * pf.r * s * 0.8, pf.y + pf.ny * pf.r * s * 0.8,
				back - s * (0.9 + flap), f.L * 0.17, f.L * 0.08, finColor, 0.55);
		}

		// tail fin: two lobes off the last joint
		const tail = fr[fr.length - 1];
		const tb = Math.atan2(-tail.ty, -tail.tx);
		for (const s of [-1, 1]) {
			drawFin(tail.x, tail.y, tb + s * 0.42, f.L * 0.24, f.L * 0.1, finColor, 0.6);
		}

		// body outline path
		ctx.save();
		ctx.globalAlpha = 1;
		const body = new Path2D();
		for (let i = 0; i < fr.length; i++) {
			const p = fr[i];
			const x = p.x + p.nx * p.r, y = p.y + p.ny * p.r;
			i ? body.lineTo(x, y) : body.moveTo(x, y);
		}
		for (let i = fr.length - 1; i >= 0; i--) {
			const p = fr[i];
			body.lineTo(p.x - p.nx * p.r, p.y - p.ny * p.r);
		}
		body.closePath();
		// rounded nose
		const h = fr[0];
		body.moveTo(h.x + h.r, h.y);
		body.arc(h.x, h.y, h.r, 0, TAU);
		ctx.clip(body, "nonzero");

		ctx.fillStyle = f.pattern.base;
		ctx.fillRect(-1e4, -1e4, 2e4, 2e4);

		for (const p of f.pattern.patches) {
			const s = at(fr, p.u);
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(s.x + s.nx * s.r * p.side, s.y + s.ny * s.r * p.side, s.r * p.size, 0, TAU);
			ctx.fill();
		}

		// shading: darker flanks, lighter spine
		ctx.globalAlpha = 0.35;
		ctx.strokeStyle = "#000";
		ctx.lineWidth = f.L * 0.035;
		ctx.stroke(body);
		ctx.globalAlpha = 0.18;
		ctx.strokeStyle = "#fff";
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.beginPath();
		for (let i = 0; i < fr.length * 0.8; i++) {
			const p = fr[i];
			i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
		}
		ctx.lineWidth = f.L * 0.06;
		ctx.stroke();
		ctx.restore();

		// eyes
		const e = at(fr, 0.04);
		ctx.fillStyle = "#000";
		for (const s of [-1, 1]) {
			ctx.beginPath();
			ctx.arc(e.x + e.nx * e.r * 0.6 * s, e.y + e.ny * e.r * 0.6 * s, f.L * 0.012, 0, TAU);
			ctx.fill();
		}
	}

	/* ---------- canvas -> ascii ---------- */
	function classOf(r, g, b, lum) {
		const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
		if (mx - mn < 45) return lum > 110 ? "w" : "k";
		return r > g * 2.2 ? "r" : "o";
	}

	function render() {
		const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		const stride = canvas.width * 4;
		const n = SS * SS;
		const lines = new Array(rows);

		for (let y = 0; y < rows; y++) {
			let line = "", cur = "";
			for (let x = 0; x < cols; x++) {
				let R = 0, G = 0, B = 0, A = 0;
				for (let sy = 0; sy < SS; sy++) {
					let i = (y * SS + sy) * stride + x * SS * 4;
					for (let sx = 0; sx < SS; sx++, i += 4) {
						const a = px[i + 3];
						if (!a) continue;
						R += px[i] * a; G += px[i + 1] * a; B += px[i + 2] * a; A += a;
					}
				}
				const cov = A / (255 * n);
				if (cov < 0.22) {
					if (cur) { line += "</span>"; cur = ""; }
					line += " ";
					continue;
				}
				R /= A; G /= A; B /= A;
				const lum = 0.299 * R + 0.587 * G + 0.114 * B;
				const k = classOf(R, G, B, lum);
				const d = k === "k" ? cov * 0.55 : cov * (0.3 + 0.7 * lum / 255);
				const glyph = RAMP[clamp(Math.round(d * (RAMP.length - 1)), 1, RAMP.length - 1)];
				if (k !== cur) {
					if (cur) line += "</span>";
					line += `<span class="${k}">`;
					cur = k;
				}
				line += glyph;
			}
			if (cur) line += "</span>";
			lines[y] = line;
		}
		pond.innerHTML = lines.join("\n");
	}

	function draw(t) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(SS / cw, 0, 0, SS / ch, 0, 0);
		for (const f of fish) drawFish(f, t);
		render();
	}

	/* ---------- loop ---------- */
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	let last = performance.now(), acc = 0;

	function tick(now) {
		const dt = Math.min(0.1, (now - last) / 1000);
		last = now;
		acc += dt;
		if (acc >= 1 / FPS) {
			for (const f of fish) step(f, acc);
			// skip the expensive ASCII pass while the pond is scrolled out of view
			if (window.scrollY < H) draw(now / 1000);
			acc = 0;
		}
		requestAnimationFrame(tick);
	}

	function start() {
		measure();
		spawn();
		draw(0);
		if (!reduced) requestAnimationFrame((t) => { last = t; tick(t); });
	}

	let resizeTimer = 0;
	window.addEventListener("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			const oldW = W, oldH = H;
			measure();
			for (const f of fish) for (const p of f.pts) { p.x *= W / oldW; p.y *= H / oldH; }
			for (const f of fish) pickTarget(f);
			if (reduced) draw(0);
		}, 150);
	});
	window.addEventListener("pointermove", (e) => { mouse.x = e.pageX; mouse.y = e.pageY; });
	window.addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
	else start();
})();

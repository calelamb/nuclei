# Nuclei Hero GIF — Recording Checklist

**Goal:** One 25-30 second looping MP4/GIF that goes at the top of the README and does 60% of your star conversion work. Someone should get the whole value prop in under 10 seconds.

**Total time to execute:** ~20 minutes including retakes.

---

## Part 1 — Prep (5 min)

**Tools to install before you start:**

- **Kap** — free Mac screen recorder, great for GIFs. Download: https://getkap.co
  - Alternative: QuickTime (built-in) → record, then convert
- **Gifski** — optional, best GIF quality/size compression. `brew install gifski`
- **ffmpeg** — for MP4 conversion. `brew install ffmpeg`

**Window setup:**

1. Launch Nuclei
2. Resize the window to exactly **1440 × 900** (close to 16:10, clean for both Twitter and GitHub README)
3. Close the terminal panel at the bottom — you want maximum vertical space for the visualizations
4. Open the Dirac chat panel on the right side but collapse it for now (you'll expand it during recording)
5. Make sure your editor has:
   - Dark theme
   - JetBrains Mono, 14pt minimum (so it's readable in a 600px-wide GIF)
   - An empty `main.py` ready to go
6. Hide any macOS notifications, dock, and mouse cursor if Kap supports it (it does — there's a "Hide cursor" option)

**Important:** Before recording, do a 30-second dry run of the full sequence below without recording. Muscle-memory the typing so it flows. Hesitation kills the GIF.

---

## Part 2 — The Sequence (5 beats, ~25 seconds)

Record in Kap at **30 fps** (not 60 — keeps file size down and looks fine for a code demo).

### Beat 1 — The "it renders live" hook (0:00 – 0:04)

Start recording with an **empty editor**. Wait half a second so viewers see the clean state.

Type slowly (aim for ~8-10 chars/sec, slower than normal typing so viewers can follow):

```python
from qiskit import QuantumCircuit
qc = QuantumCircuit(2)
qc.h(0)
```

**Critical moment:** As soon as `qc.h(0)` finishes typing, the circuit panel on the right should render an H gate. **Pause for 0.5 seconds here.** This half-second is the most important frame in the entire GIF — it's where viewers "get it."

### Beat 2 — Entanglement (0:04 – 0:08)

Type:

```python
qc.cx(0, 1)
```

The CNOT appears. The Bloch sphere for q0 should be in superposition (pointing roughly at the +X axis). Let it breathe for 1 full second.

### Beat 3 — Simulate (0:08 – 0:13)

Hit **Cmd+Enter** (or whatever your run shortcut is). The histogram panel should pop in showing ~50/50 `|00⟩` and `|11⟩`.

**Pause 1.5 seconds** on the histogram. This is where people read the output and go "oh, it's a Bell state."

### Beat 4 — Dirac enters the chat (0:13 – 0:21)

Click the Dirac chat panel to expand it (or use your keyboard shortcut). Type:

> Why are only 00 and 11 possible?

Press Enter. Let Dirac's response stream in. You don't need to wait for the full response — **3-4 seconds of streaming text is enough**. Viewers just need to see that an AI is responding in context.

Cut the beat as soon as the first sentence of Dirac's response is fully visible (something like *"Because the CNOT entangles q0 and q1..."*).

### Beat 5 — The wow moment: interactive Bloch (0:21 – 0:27)

Click on the Bloch sphere panel. Click and drag to rotate it smoothly — show it's actually 3D and interactive, not a static image. Do one slow rotation (~3 seconds).

End on a clean frame with everything visible: editor with code, circuit diagram, rotated Bloch sphere, histogram, and Dirac chat panel with the response. Hold that final frame for 1 full second.

**Stop recording.**

---

## Part 3 — Post-production (5 min)

1. **Trim** the ends in Kap (remove any fumbling at the start/end)
2. **Export as MP4** first (Kap → Export → MP4, 30fps, 1440x900)
3. **Convert to smaller versions:**

```bash
# Full-res MP4 for the README (GitHub allows <100MB)
ffmpeg -i nuclei-demo.mp4 -vf "scale=1200:-1" -c:v libx264 -crf 23 -preset slow -movflags +faststart nuclei-demo-readme.mp4

# Smaller GIF version for places that don't support video
ffmpeg -i nuclei-demo.mp4 -vf "fps=20,scale=800:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i nuclei-demo.mp4 -i palette.png -filter_complex "fps=20,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse" nuclei-demo.gif
```

Target sizes:
- **MP4 for README:** under 10 MB
- **GIF for Twitter:** under 5 MB, 800px wide

If GIF is over 5 MB, drop to `fps=15` and `scale=600:-1`.

---

## Part 4 — Put it at the top of the README

Open `README.md` and add this *above* everything else (even above the project title, or right below it):

```markdown
<p align="center">
  <img src="./docs/nuclei-demo.gif" alt="Nuclei demo: live quantum circuit editor with Bloch sphere and AI tutor" width="800">
</p>
```

Or — even better if the MP4 is small enough — use the video tag, which GitHub renders inline:

```markdown
<p align="center">
  <video src="./docs/nuclei-demo.mp4" width="800" autoplay loop muted playsinline></video>
</p>
```

Put the asset file(s) in `docs/` (or `assets/` — whatever matches your existing convention).

---

## Common mistakes to avoid

- **Don't narrate.** No voiceover, no text overlays, no captions. The visuals should speak for themselves. A clean silent GIF converts better than a polished narrated video for technical audiences.
- **Don't show the file menu or onboarding screen.** Start in a clean empty editor. Anything that looks like "setup" or "configuration" kills interest.
- **Don't show errors or stack traces.** Use a project you know works. Do a dry run first.
- **Don't use light theme.** Dark theme is what HN/Reddit developers default to — the GIF should match their expectations.
- **Don't make the typing too fast.** Your muscle memory will betray you. Slow it down so viewers can actually read what you're typing.
- **Don't forget to loop.** GIFs auto-loop, but MP4s need `loop muted` attributes.

---

## When you're done

Commit the asset, update the README, push, and verify it renders correctly on the GitHub repo page (not just in a local preview). GitHub's image proxy can do weird things with large GIFs.

Then you're ready to post Show HN. The GIF is your single highest-leverage asset — everything else rides on it.

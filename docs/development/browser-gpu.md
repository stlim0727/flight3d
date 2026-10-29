# Browser selection and hardware GPU verification

Use Obscura for ordinary DOM/browser work. Use installed Chrome directly for
WebGL/WebGL2/3D or when Obscura cannot execute or render the page correctly.
No extra approval is needed for that fallback. Do not reinstall browser binaries.
These rules apply to every agent, including delegated agents and MCP launches.

Chrome must use hardware GPU acceleration. Headless mode still supports it.
Never silently fall back to software; software rendering requires explicit user
approval for that task and does not count as hardware evidence.

## Check the execution environment first

Run in the executor that will launch Chrome:

```sh
id
ls -l /dev/dri/renderD128
```

The Linux test host exposes Intel Graphics (ADL-N) through `renderD128`; the
account needs read/write access (normally render/video groups). A sandbox can
hide the device even while the host has it. Retry the authorized host execution
path before reporting no GPU. Escalation does not itself prove GPU access: inspect
the device and renderer in that execution path. Investigate permissions, drivers
and browser configuration if initialization fails. Report an unresolved blocker.

## Launch an isolated hardware browser

Check that the CDP port is free. Set a task-specific profile and keep ownership of
that browser; do not stop another agent's browser. This Linux host uses:

```sh
google-chrome-stable --headless=new \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9441 \
  --user-data-dir=/tmp/flight3d-my-task-chrome \
  --enable-gpu --use-gl=angle --use-angle=vulkan \
  --disable-software-rasterizer about:blank
```

Keep the normal Chrome sandbox when supported; add `--no-sandbox` only when the
execution environment requires it. Do not add GPU rasterization/zero-copy tuning
without measuring it; it is unnecessary for WebGL acceleration on this host.

Inspect the wrapper/MCP arguments and inherited environment before reuse.
Do not pass `--disable-gpu`, `--disable-gpu-compositing`,
`--use-gl=swiftshader`, `--use-angle=swiftshader`,
`--use-angle=swiftshader-webgl`, or `--enable-unsafe-swiftshader`.
Do not set `LIBGL_ALWAYS_SOFTWARE=1` or select software Vulkan ICDs.
A running browser keeps its launch flags; changing a wrapper requires relaunching
only the browser owned by this task.

For this user, `command -v chrome-headless` must resolve to
`/home/stlim/.local/bin/chrome-headless`. It defaults to Vulkan and rejects
common software/GPU-disabling arguments. The legacy root-owned
`/usr/local/bin/chrome-headless` disables the GPU; do not invoke it directly.
The user wrapper lives outside the repository and must be provisioned separately
on another host; the explicit command above is the portable reference.

Some older acceptance scripts still select software automatically when device
visibility checks fail, or accept `FORCE_GPU=0`. Inspect their launch arguments
before running them. Set a supported hardware mode or use a checked CDP browser;
if the script has no safe hardware path, fix its launcher first. Historical CI
software results are not hardware validation and do not authorize a local agent
to use software rendering. This guidance does not change hosted CI configuration.

## Require a passing preflight

With that browser running, from the repository root:

```sh
GPU_REPORT=/tmp/flight3d-my-task-gpu.json \
  node scripts/verify-browser-gpu.mjs http://127.0.0.1:9441
```

The command checks readable/writable render nodes in its own executor, creates
an actual WebGL2 context, and inspects `WEBGL_debug_renderer_info`. It rejects
SwiftShader, llvmpipe, softpipe, lavapipe, missing/unknown renderer information,
and malformed/incomplete evidence. If renderer information is hidden, investigate
browser GPU diagnostics instead of claiming a pass.

It compiles shaders, draws a red triangle over a blue clear color, and checks
that the center pixel is exactly `[255, 0, 0, 255]` with GL error `0`. A context,
GPU process, launch flag, device file, or successful build alone is insufficient.
It closes only its probe tab and returns a nonzero exit status on failure.

Then run the scenario against the same browser endpoint. A preflight proves
GPU setup, not simulator correctness: inspect actual scene screenshots and run
the relevant state/interaction assertions. Record browser, renderer, pixel result,
scenario checks and limitations. Never attribute Chrome evidence to Obscura.
Pass this procedure and the endpoint to any delegated worker doing browser tests.

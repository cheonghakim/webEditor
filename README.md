# 🧩 CodePlayground

A lightweight **in-browser playground** for **HTML, CSS, JavaScript, and Rust (WASM)**.  
Type on the left, see changes live on the right — **no setup required.**

You can even attach **CDN libraries** on the fly or compile **Rust → WebAssembly** directly in the browser.  
(📂 File upload / multi-file support is on the roadmap.)

---

## ✨ Features

### 🪶 Live Preview  
Instant feedback as you edit **HTML, CSS, JS, or Rust** — no page reload needed.

### 🔗 CDN Support  
Quickly attach external libraries (e.g., Three.js, PixiJS, Vue) by URL.

### 🧹 One-Click Formatting  
Keep your code tidy and consistent with the built-in formatter.

### ⚙️ Rust → WASM Integration  
Write Rust inline and compile to WebAssembly automatically using  
[`wasm-bindgen`](https://rustwasm.github.io/wasm-bindgen/) and [`wasm-pack`](https://github.com/rustwasm/wasm-pack).  
The compiled module becomes available as `window.__rust`, so you can call exported functions directly from JS.

### 🚀 Zero Config  
Open the page and start coding — everything runs client-side.

---

## 🧠 How to Use

1. **Write or paste** your HTML, CSS, JS, and Rust (WASM) into each panel.  
2. Click **Run**, or rely on **auto-update** to refresh the live preview.  
3. Use **Add CDN** to include frameworks or utilities on demand.  
4. Hit **Format** anytime to clean up your code.  
5. In your JS panel, wait for the Rust module to load:

```js
   const rust = await window.__rust;
   console.log(rust.add(2, 3));
```
```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

<img width="1919" height="890" alt="image" src="https://github.com/user-attachments/assets/cf2f4a81-fc16-4583-8fc0-d0c31eb805ff" />

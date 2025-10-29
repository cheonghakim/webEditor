export class CodePlayground {
  // Persist editors in localStorage
  static KEY = "mini-playground-v1";

  constructor({ meta = "", title = "", html, css, js, rust = "", tabs }) {
    this.initCode = { html, css, js, rust };

    this.debounce = null;
    this.libs = [];
    this.tabs = tabs;

    this.meta = meta;
    this.title = title;

    this.jsCode = null;
    this.cssCode = null;
    this.htmlCode = null;

    this.reqId = 0;
    this.compileTime = null;
    this.currentCompileAbort = null; // AbortController for /compile

    // Libraries list (CDN scripts)
    this.els = {
      html: null,
      css: null,
      js: null,
      rust: null,
      frame: document.getElementById("frame"),
      log: document.getElementById("console"),
      runBtn: document.getElementById("runBtn"),
      resetBtn: document.getElementById("resetBtn"),
      status: document.getElementById("status"),
      libUrl: document.getElementById("libUrl"),
      addLib: document.getElementById("addLib"),
    };

    this.scheduleRunEvt = this.scheduleRun.bind(this);
    this.runEvt = this.run.bind(this);
    this.resetEvt = this.reset.bind(this);
    this.addLibEvt = this.addLibByCdn.bind(this);
    this.onMsgEvt = this.onMsg.bind(this);
    this.onKeyDownEvt = this.onKeyDown.bind(this);
    this.onFormattingEvt = this.onFormatting.bind(this);

    // Init
    this.setStarter();
    this.bindEvents();
  }

  destruct() {
    this.els?.addLib?.removeEventListener("click", this.addLibEvt);
    this.els?.runBtn?.removeEventListener("click", this.runEvt);
    this.els?.resetBtn?.removeEventListener("click", this.resetEvt);
    window.removeEventListener("message", this.onMsgEvt);
    window.removeEventListener("keydown", this.onKeyDownEvt);
    document
      .getElementById("formatting")
      ?.removeEventListener("click", this.onFormattingEvt);

    clearTimeout(this.debounce);
    clearTimeout(this.compileTime);
    try {
      this.currentCompileAbort?.abort();
    } catch (_) {}

    this.tabs?.destroy();
  }

  bindEvents() {
    this.els.addLib?.addEventListener("click", this.addLibEvt);
    this.els.runBtn?.addEventListener("click", this.runEvt);
    this.els.resetBtn?.addEventListener("click", this.resetEvt);
    window.addEventListener("message", this.onMsgEvt);
    window.addEventListener("keydown", this.onKeyDownEvt);
    document
      .getElementById("formatting")
      ?.addEventListener("click", this.onFormattingEvt);
  }

  // keydown 이벤트
  onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      this.run();
    }
  }

  // 프리뷰창 콘솔 표시 메세지 이벤트 핸들러
  onMsg(e) {
    const data = e.data || {};
    if (!data.__mini) return;

    const msg = (data.args || [])
      .map((v) => {
        if (typeof v === "string") return v;
        try {
          return JSON.stringify(v, null, 2);
        } catch {
          return String(v);
        }
      })
      .join(" ");
    this.print(
      data.type === "warn" ? "warn" : data.type === "error" ? "error" : "log",
      msg
    );
  }

  // CDN 추가
  addLibByCdn() {
    const u = this.els.libUrl?.value?.trim();
    if (!u) return;
    // URL 유효성/중복 체크
    try {
      // 허용: 절대/상대 모두. 상대면 base는 location.href
      new URL(u, window.location.href);
    } catch {
      this.print("warn", "Invalid URL");
      return;
    }
    if (!this.libs.includes(u)) this.libs.push(u);
    if (this.els.libUrl) this.els.libUrl.value = "";
    this.scheduleRun();
  }

  loadState() {
    try {
      return JSON.parse(localStorage.getItem(CodePlayground.KEY)) || {};
    } catch {
      return {};
    }
  }

  saveState(state) {
    try {
      localStorage.setItem(CodePlayground.KEY, JSON.stringify(state));
    } catch (e) {
      this.print("warn", "LocalStorage is full or blocked.");
    }
  }

  setStarter() {
    const saved = this.loadState();

    // 이전 인스턴스가 있었다면 원복
    this.els.js?.toTextArea?.();
    this.els.css?.toTextArea?.();
    this.els.html?.toTextArea?.();
    this.els.rust?.toTextArea?.();

    // 에디터 있는지 체크
    const jsEl = document.getElementById("js");
    const cssEl = document.getElementById("css");
    const htmlEl = document.getElementById("html");
    const rustEl = document.getElementById("rust");

    if (!jsEl || !cssEl || !htmlEl || !rustEl) {
      this.updateStatus("Missing editor elements");
      return;
    }

    this.setupLazyInitOnTabShow(saved);

    if (htmlEl && !this.els.html) {
      this.els.html = CodeMirror.fromTextArea(htmlEl, {
        lineNumbers: true,
        mode: "htmlmixed",
        tabSize: 2,
        autoCloseBrackets: true,
        autoCloseTags: true,
      });
      this.els.html.on("changes", this.scheduleRunEvt);
      this.els.html.setValue(saved.html ?? this.initCode.html);
    }
    if (cssEl && !this.els.css) {
      this.els.css = CodeMirror.fromTextArea(cssEl, {
        lineNumbers: true,
        mode: "css",
        tabSize: 2,
        autoCloseBrackets: true,
      });
      this.els.css.on("changes", this.scheduleRunEvt);
      this.els.css.setValue(saved.css ?? this.initCode.css);
    }
    if (jsEl && !this.els.js) {
      this.els.js = CodeMirror.fromTextArea(jsEl, {
        lineNumbers: true,
        mode: "javascript",
        tabSize: 2,
        autoCloseBrackets: true,
      });
      this.els.js.on("changes", this.scheduleRunEvt);
      this.els.js.setValue(saved.js ?? this.initCode.js);
    }

    if (rustEl && !this.els.rust) {
      this.els.rust = CodeMirror.fromTextArea(rustEl, {
        lineNumbers: true,
        mode: "rust",
        theme: "default",
        tabSize: 2,
        autoCloseBrackets: true,
      });
      this.els.rust.on("changes", this.scheduleRunEvt);
      this.els.rust.setValue(saved.rust ?? this.initCode.rust ?? "");
    }

    // 라이브러리 초기화
    this.libs = Array.isArray(saved.libs) ? saved.libs : [];

    // 상태 변경
    this.updateStatus("Ready");

    // 실행
    this.scheduleRun();
  }

  setupLazyInitOnTabShow(saved) {
    const ensure = (id, make) => {
      if (!this.els[id]) {
        this.els[id] = make();
        this.els[id].on("changes", this.scheduleRunEvt);
        const key = id === "html" ? "html" : id;
        this.els[id].setValue(saved[key] ?? this.initCode[key]);
      }
      setTimeout(() => this.els[id]?.refresh(), 0);
    };
    const initByPanelId = (pid) => {
      const map = {
        htmlCode: "html",
        cssCode: "css",
        jsCode: "js",
        rustCode: "rust",
      };
      const id = map[pid];
      if (!id) return;
      ensure(id, () =>
        CodeMirror.fromTextArea(document.getElementById(id), {
          lineNumbers: true,
          mode: id === "html" ? "htmlmixed" : id,
          tabSize: 2,
          autoCloseBrackets: true,
          autoCloseTags: id === "html",
        })
      );
    };

    document.addEventListener(
      "tabby",
      function (event) {
        const tab = event.target;
        const content = event.detail.content;
        console.log(tab);
        const pid = tab.getAttribute("aria-controls");
        initByPanelId(pid);
      },
      false
    );
  }

  // 파서를 얻기
  pickPrettierParser(cm) {
    const mode = cm.getMode().name; // 'javascript' | 'css' | 'htmlmixed' 등
    if (mode === "htmlmixed" || mode === "xml" || mode === "html")
      return "html";
    if (mode === "css") return "css";
    if (mode === "javascript") return "babel";
    if (mode === "typescript") return "typescript";
    return "babel";
  }

  // 포맷 변경
  async onFormatting() {
    if (
      typeof prettier === "undefined" ||
      typeof prettierPlugins === "undefined"
    ) {
      this.print("warn", "Prettier not loaded.");
      return;
    }

    const currCssCode = this.els.css.getValue();
    const currHtmlCode = this.els.html.getValue();
    const currJsCode = this.els.js.getValue();

    try {
      const [formattedCss, formattedHtml, formattedJs] = await Promise.all([
        prettier.format(currCssCode, {
          parser: "css",
          plugins: prettierPlugins,
          tabWidth: 2,
          semi: true,
          singleQuote: true,
        }),
        prettier.format(currHtmlCode, {
          parser: "html",
          plugins: prettierPlugins,
          tabWidth: 2,
          semi: true,
          singleQuote: true,
        }),
        prettier.format(currJsCode, {
          parser: "babel",
          plugins: prettierPlugins,
          tabWidth: 2,
          semi: true,
          singleQuote: true,
        }),
      ]);

      // 커서/스크롤 보존
      const apply = (ed, val) =>
        ed.operation(() => {
          const sel = ed.listSelections();
          const scroll = {
            left: ed.getScrollInfo().left,
            top: ed.getScrollInfo().top,
          };
          ed.setValue(val);
          ed.setSelections(sel);
          ed.scrollTo(scroll.left, scroll.top);
        });
      apply(this.els.css, formattedCss);
      apply(this.els.html, formattedHtml);
      apply(this.els.js, formattedJs);

      // rust 포맷 (옵션)
      this.formatRust();
    } catch (error) {
      alert(error?.message ?? String(error));
    }
  }

  async formatRust() {
    if (!this.els.rust) return; // rust 비활성 시 무시
    try {
      const src = this.els.rust.getValue();
      const res = await fetch("/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: src }),
      });
      const { formatted } = await res.json();
      if (typeof formatted === "string") {
        this.els.rust.setValue(formatted);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async compileAndLoad(rustSource) {
    const myId = ++this.reqId; // 이 호출 고유 번호
    this.updateStatus("Compiling…");

    // 이전 요청 취소
    try {
      this.currentCompileAbort?.abort();
    } catch (_) {}
    const ctrl = new AbortController();
    this.currentCompileAbort = ctrl;

    const res = await fetch("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: rustSource }),
      signal: ctrl.signal,
    });

    const j = await res.json();
    if (myId !== this.reqId) return; // 더 최신 요청이 있으면 무시
    if (!j.ok) throw new Error(j.error || "Compile failed");
    this.updateStatus("Done");
    return j; // { ok:true, baseUrl: "/artifact/<hash>", ... }
  }

  updateStatus(msg) {
    if (this.els.status) this.els.status.textContent = msg;
  }

  // Simple debounce live-run
  scheduleRun() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(this.run.bind(this), 500);
    this.updateStatus("Building…");
  }

  // Capture console via postMessage + 프리뷰 HTML 생성
  makePreviewHTML(html, css, js, rust, externalScripts = []) {
    const escScript = (s) => (s || "").replace(/<\/(script)/gi, "<\\/$1>");
    const escAttr = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }[c])
      );

    // externalScripts가 문자열/undefined로 오더라도 안전 처리
    const libs = (
      Array.isArray(externalScripts) ? externalScripts : [externalScripts]
    )
      .filter(Boolean)
      .map((src) => `<script src="${src}"><\/script>`)
      .join("\n");

    // rust 인자는 falsy 또는 { baseUrl, exposeAs?, initName? }
    const rustModuleBlock = (() => {
      if (!rust || !rust.baseUrl) return "";
      const exposeAs = rust.exposeAs || "__rust";
      const initName = rust.initName || "default";
      const modUrl = `${rust.baseUrl}/hello_wasm.js?v=${Date.now()}`;
      const wasmUrl = `${rust.baseUrl}/hello_wasm_bg.wasm?v=${Date.now()}`;

      return `
        // Rust module loader
        window.__rust = undefined;
        window.__rustReady = (async () => {
          try {
            const m = await import("${modUrl}");
            const __init =
              (typeof m["${initName}"] === "function") ? m["${initName}"] :
              (typeof m.default === "function") ? m.default :
              m.init;
            if (typeof __init === "function") {
              try { await __init(); }
              catch { await __init(new URL("${wasmUrl}", window.location.href)); }
            }
            window["${exposeAs}"] = m; // 호환성: window.__rust == 모듈
            window.__rust = m;
            return m;
          } catch (e) {
            console.error(e);
            document.body.insertAdjacentHTML(
              "beforeend",
              '<pre style="color:#f55">'+ String(e).replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s])) +'</pre>'
            );
            throw e;
          }
        })();
      `;
    })();

    return `<!doctype html>
  <html>
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta itemprop="description" content="${escAttr(this.meta)}" />
  <title>${escAttr(this.title)}</title>
  <style>${css || ""}</style>
  ${libs}
  </head>
  <body>
  ${html || ""}

  <!-- 콘솔/에러 브리지 -->
  <script>
  (function(){
    function safeToString(v) {
      if (v === null) return "null";
      const t = typeof v;
      if (t === "string" || t === "number" || t === "boolean") return String(v);
      if (t === "undefined") return "undefined";
      if (t === "symbol") { try { return v.toString(); } catch(_) { return "Symbol"; } }
      if (t === "bigint") { try { return v.toString() + "n"; } catch(_) { return "bigint"; } }
      if (t === "function") return "[Function" + (v.name ? " " + v.name : "") + "]";
      if (v instanceof Error) return v.stack || v.message || String(v);
      try {
        const seen = new WeakSet();
        return JSON.stringify(v, function (_k, val) {
          if (val && typeof val === "object") {
            if (seen.has(val)) return "[Circular]";
            seen.add(val);
          }
          if (typeof val === "function") return "[Function" + (val.name ? " " + val.name : "") + "]";
          if (typeof val === "symbol") { try { return val.toString(); } catch (_) { return "Symbol"; } }
          if (typeof val === "bigint") { try { return val.toString() + "n"; } catch (_) { return "bigint"; } }
          return val;
        });
      } catch (_) {
        try { return String(v); } catch (_) { return Object.prototype.toString.call(v); }
      }
    }

    function send(type, args){
      try {
        const arr = Array.from(args).map(safeToString);
        try {
          parent.postMessage({ __mini: true, type, args: arr }, '*');
        } catch (_) {}
      } catch (_) {}
    }

    ['log','info','warn','error'].forEach(k=>{
      const orig = (typeof console !== 'undefined' && console[k] && console[k].bind(console)) || function(){};
      console[k] = function(){
        try { send(k, arguments); } catch(_) {}
        try { return orig.apply(console, arguments); } catch(_) {}
      };
    });

    window.addEventListener('error', e=>{
      try {
        const message = (e && (e.message || (e.error && e.error.message))) || 'Error';
        const filename = (e && (e.filename || '')) || '';
        const lineno = (e && (e.lineno || '')) || '';
        const stack = (e && e.error && e.error.stack) ? e.error.stack : '';
        const payload = message + '\\n' + filename + ':' + lineno + '\\n' + stack;
        try { parent.postMessage({ __mini:true, type:'error', args:[payload] }, '*'); } catch(_) {}
      } catch (_) {}
    });
  })();
  <\/script>

  <!-- 사용자 JS -->
  <script type="module">
    (async () => {
      ${rustModuleBlock}
      // Rust 모듈을 사용하는 코드가 있다면 준비 보장
      if (window.__rustReady && typeof window.__rustReady.then === "function") {
        try { await window.__rustReady; } catch(e) { /* rust 초기화 실패 시에도 사용자 JS는 계속 실행할지 정책에 따라 결정 */ }
      }
      ${escScript(js)}
    })();
  <\/script>

  </body></html>`;
  }

  clearConsole() {
    if (this.els.log) {
      this.els.log.innerHTML = "";
    }
  }

  print(kind, text) {
    if (!this.els.log) return;
    const div = document.createElement("div");
    div.className = kind;
    div.textContent = text;
    this.els.log.appendChild(div);
    this.els.log.scrollTop = this.els.log.scrollHeight;
  }

  async run() {
    // 상태 저장
    this.saveState({
      html: this.els.html.getValue(),
      css: this.els.css.getValue(),
      js: this.els.js.getValue(),
      rust: this.els.rust ? this.els.rust.getValue() : "",
      libs: this.libs,
    });
    this.clearConsole();

    clearTimeout(this.compileTime);
    this.compileTime = setTimeout(async () => {
      try {
        // Rust 소스가 있을 때만 컴파일
        const rustSrc = this.els.rust ? this.els.rust.getValue().trim() : "";
        let rustRes = null;
        if (rustSrc) {
          rustRes = await this.compileAndLoad(rustSrc);
        }

        const html = this.makePreviewHTML(
          this.els.html.getValue(),
          this.els.css.getValue(),
          this.els.js.getValue(),
          rustRes,
          this.libs
        );

        // 미리보기 생성
        const r = await fetch("/preview", { method: "POST", body: html });
        const { id } = await r.json();
        if (!id) throw new Error("Preview endpoint failed");
        if (this.els.frame) {
          this.els.frame.src = `/preview/${id}`; // 동일 오리진
        }
        this.updateStatus("Running");
      } catch (err) {
        this.print("error", err?.message || String(err));
        this.updateStatus("Preview failed");
      }
    }, 400);
  }

  reset() {
    try {
      localStorage.removeItem(CodePlayground.KEY);
    } catch (_) {}
    this.libs = [];
    this.setStarter();
    this.clearConsole();
  }
}

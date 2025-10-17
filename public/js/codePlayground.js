export class CodePlayground {
  // Persist editors in localStorage
  static KEY = "mini-playground-v1";
  constructor({ meta = "", title = "", html, css, js, rust = "" }) {
    this.initCode = {
      html,
      css,
      js,
      rust,
    };

    this.debounce = null;
    this.libs = [];

    this.meta = meta;
    this.title = title;

    this.jsCode = null;
    this.cssCode = null;
    this.htmlCode = null;

    let reqId = 0;
    this.compileTime = null;

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
  }

  bindEvents() {
    // Bindings
    this.els.addLib.addEventListener("click", this.addLibEvt);
    this.els.runBtn.addEventListener("click", this.runEvt);
    this.els.resetBtn.addEventListener("click", this.resetEvt);
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
    const u = this.els.libUrl.value.trim();
    if (!u) return;
    this.libs.push(u);
    this.els.libUrl.value = "";
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
    localStorage.setItem(CodePlayground.KEY, JSON.stringify(state));
  }

  setStarter() {
    const saved = this.loadState();
    this.els.js?.toTextArea?.();
    this.els.css?.toTextArea?.();
    this.els.html?.toTextArea?.();
    this.els.rust?.toTextArea?.();

    // 에디터 있는지 체크
    const jsEl = document.getElementById("js");
    const cssEl = document.getElementById("css");
    const htmlEl = document.getElementById("html");
    if (!jsEl || !cssEl || !htmlEl) {
      this.updateStatus("Missing editor elements");
      return;
    }

    this.els.js = CodeMirror.fromTextArea(document.getElementById("js"), {
      lineNumbers: true, // 행 번호 표시
      mode: "javascript", // 언어 모드
      theme: "default", // 테마
      tabSize: 2, // 탭 크기
    });
    this.els.css = CodeMirror.fromTextArea(document.getElementById("css"), {
      lineNumbers: true, // 행 번호 표시
      mode: "css", // 언어 모드
      theme: "default", // 테마
      tabSize: 2, // 탭 크기
    });
    this.els.html = CodeMirror.fromTextArea(document.getElementById("html"), {
      lineNumbers: true, // 행 번호 표시
      mode: "htmlmixed", // 언어 모드
      theme: "default", // 테마
      tabSize: 2, // 탭 크기
    });
    this.els.rust = CodeMirror.fromTextArea(document.getElementById("rust"), {
      lineNumbers: true, // 행 번호 표시
      mode: "rust", // 언어 모드
      theme: "default", // 테마
      tabSize: 2, // 탭 크기
    });

    // 변경시 즉시 실행 이벤트
    this.els.js.on("changes", this.scheduleRunEvt);
    this.els.css.on("changes", this.scheduleRunEvt);
    this.els.html.on("changes", this.scheduleRunEvt);
    this.els.rust.on("changes", this.scheduleRunEvt);

    // 기본 코드 설정
    this.els.html.setValue(saved.html ?? this.initCode.html);
    this.els.css.setValue(saved.css ?? this.initCode.css);
    this.els.js.setValue(saved.js ?? this.initCode.js);
    this.els.rust.setValue(saved.rust ?? this.initCode.rust);

    // 라이브러리 초기화
    this.libs = saved.libs ?? [];

    // 상태 변경
    this.updateStatus("Ready");

    // 실행
    this.scheduleRun();
  }

  // 파서를 얻기
  pickPrettierParser(cm) {
    const mode = cm.getMode().name; // 'javascript' | 'css' | 'htmlmixed' 등
    if (mode === "htmlmixed" || mode === "xml" || mode === "html")
      return "html";
    if (mode === "css") return "css";
    if (mode === "javascript") return "babel";
    if (mode === "typescript") return "typescript";
    // 기본값
    return "babel";
  }

  // 포맷 변경
  async onFormatting() {
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

      // rust 포맷
      this.formatRust();
    } catch (error) {
      alert(error?.message ?? String(error));
    }
  }

  async formatRust() {
    try {
      const src = this.els.rust.getValue();
      const res = await fetch("/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: src }),
      });
      const { formatted } = await res.json();
      this.els.rust.setValue(formatted);
    } catch (error) {
      console.error(error);
    }
  }

  async compileAndLoad(rustSource) {
    const myId = ++this.reqId; // 이 호출 고유 번호
    this.status("Compiling…");

    const res = await fetch("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: rustSource }),
    });
    const j = await res.json();
    if (myId !== this.reqId) return; // 더 최신 요청이 있으면 무시
    if (!j.ok) throw new Error(j.error || "Compile failed");

    this.status("Done");
    return j;
  }

  status(msg) {
    document.getElementById("status").textContent = msg;
  }

  // Simple debounce live-run

  scheduleRun() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(this.run.bind(this), 500);
    this.updateStatus("Building…");
  }

  // Capture console via postMessage
  makePreviewHTML(html, css, js, rust, externalScripts = []) {
    const esc = (s) => (s || "").replace(/<\/(script)/gi, "<\\/$1");

    // externalScripts가 문자열/undefined로 오더라도 안전 처리
    const libs = (
      Array.isArray(externalScripts) ? externalScripts : [externalScripts]
    )
      .filter(Boolean)
      .map((src) => `<script src="${src}"><\/script>`)
      .join("\n");

    // rust 인자는 다음 형태를 기대:
    //   - falsy: Rust 없음
    //   - { baseUrl: "/artifact/<hash>", exposeAs?: "__rust", initName?: "init" }
    //      -> <script type="module">에서 import init, * as m ... 하고 window[exposeAs]=m
    const rustModuleBlock = (() => {
      if (!rust || !rust.baseUrl) return "";
      const exposeAs = rust.exposeAs || "__rust"; // window.__rust.run(...) 으로 접근
      const initName = rust.initName || "init"; // wasm-pack 기본 init
      const modUrl = `${rust.baseUrl}/hello_wasm.js?v=${Date.now()}`;
      const wasmUrl = `${rust.baseUrl}/hello_wasm_bg.wasm?v=${Date.now()}`;

      console.log(modUrl, wasmUrl);
      return `
  <script type="module">
    try {
      const m = await import("${modUrl}");
      // 명시적으로 wasm 파일 전달 (대부분 init()만으로도 OK지만 캐시 버스트 겸)
      if (m.${initName}) {
        await m.${initName}(new URL("${wasmUrl}", window.location.href));
      }
      // JS 스크립트에서 쉽게 쓰도록 window에 노출
      window["${exposeAs}"] = m;
    } catch (e) {
      console.error(e);
      document.body.insertAdjacentHTML('beforeend',
        '<pre style="color:#f55">'+ String(e).replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s])) +'</pre>');
    }
  <\/script>`;
    })();

    return `<!doctype html>
  <html>
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta itemprop="description" content="${this.meta}" />
  <title>${this.title}</title>
  <style>${css || ""}</style>
  ${libs}
  </head>
  <body>
  ${html || ""}
  
  <!-- 콘솔/에러 브리지 -->
  <script>
  (function(){
    function send(type, args){
      parent.postMessage({__mini:true, type, args: Array.from(args).map(String)}, '*');
    }
    ['log','info','warn','error'].forEach(k=>{
      const orig = console[k] && console[k].bind(console) || function(){};
      console[k] = function(){ send(k, arguments); try{ orig.apply(console, arguments); }catch(_){ } };
    });
    window.addEventListener('error', e=>{
      parent.postMessage({__mini:true, type:'error',
        args:[(e.message||'Error')+'\\n'+(e.filename||'')+':'+(e.lineno||'')+'\\n'+(e.error && e.error.stack || '')]}, '*');
    });
  })();
  <\/script>
  
  ${rustModuleBlock}
  
  <!-- 사용자가 작성한 JS (window.__rust 노출 이후 실행되므로, 여기서 __rust.run(...) 가능) -->
  <script>
  ${esc(js)}
  <\/script>
  
  </body></html>`;
  }

  clearConsole() {
    this.els.log.innerHTML = "";
  }

  print(kind, text) {
    const div = document.createElement("div");
    div.className = kind;
    div.textContent = text;
    this.els.log.appendChild(div);
    this.els.log.scrollTop = this.els.log.scrollHeight;
  }

  async run() {
    this.saveState({
      html: this.els.html.getValue(),
      css: this.els.css.getValue(),
      js: this.els.js.getValue(),
      rust: this.els.rust.getValue(),
      libs: this.libs,
    });
    this.clearConsole();

    clearTimeout(this.compileTime);
    this.compileTime = setTimeout(async () => {
      const rustRes = await this.compileAndLoad(this.els.rust.getValue());
      const html = this.makePreviewHTML(
        this.els.html.getValue(),
        this.els.css.getValue(),
        this.els.js.getValue(),
        rustRes,
        this.libs
      );
      // Use srcdoc for simplicity
      this.els.frame.srcdoc = html;
      this.updateStatus("Running");
    }, 400);
  }

  reset() {
    localStorage.removeItem(CodePlayground.KEY);
    this.libs = [];
    this.setStarter();
    this.clearConsole();
  }

  updateStatus(s) {
    this.els.status && (this.els.status.textContent = s);
  }
}

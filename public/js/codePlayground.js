export class CodePlayground {
  // Persist editors in localStorage
  static KEY = "mini-playground-v1";
  constructor({ meta = "", title = "", html, css, js }) {
    this.initCode = {
      html,
      css,
      js,
    };

    this.debounce = null;
    this.libs = [];

    this.meta = meta;
    this.title = title;

    this.jsCode = null;
    this.cssCode = null;
    this.htmlCode = null;

    // Libraries list (CDN scripts)

    this.els = {
      html: null,
      css: null,
      js: null,
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

    // 변경시 즉시 실행 이벤트
    this.els.js.on("changes", this.scheduleRunEvt);
    this.els.css.on("changes", this.scheduleRunEvt);
    this.els.html.on("changes", this.scheduleRunEvt);

    // 기본 코드 설정
    this.els.html.setValue(saved.html ?? this.initCode.html);
    this.els.css.setValue(saved.css ?? this.initCode.css);
    this.els.js.setValue(saved.js ?? this.initCode.js);

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
    } catch (error) {
      alert(error?.message ?? String(error));
    }
  }

  // Simple debounce live-run

  scheduleRun() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(this.run.bind(this), 500);
    this.updateStatus("Building…");
  }

  // Capture console via postMessage
  makePreviewHTML(html, css, js, externalScripts) {
    const esc = (s) => s.replace(/<\/(script)/gi, "<\\/$1");
    const libs = externalScripts
      .map((src) => `<script src="${src}"><\/script>`)
      .join("\n");
    return `<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta       itemprop="description" content="${
      this.meta
    }" />\n<title>${
      this.title
    }</title>\n<style>${css}</style>\n${libs}\n</head>\n<body>\n${html}\n<script>\n(function(){\n  function send(type, args){\n    parent.postMessage({__mini:true, type, args: Array.from(args).map(String)}, '*');\n  }\n  ['log','info','warn','error'].forEach(k=>{\n    const orig = console[k].bind(console);\n    console[k] = function(){ send(k, arguments); orig.apply(console, arguments); };\n  });\n  window.addEventListener('error', e=>{\n    parent.postMessage({__mini:true, type:'error', args:[(e.message||'Error')+'\\n'+(e.filename||'')+':'+(e.lineno||'')+'\\n'+(e.error && e.error.stack || '')]}, '*');\n  });\n})();\n<\/script>\n<script>\n${esc(
      js
    )}\n<\/script>\n</body></html>`;
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

  run() {
    this.saveState({
      html: this.els.html.getValue(),
      css: this.els.css.getValue(),
      js: this.els.js.getValue(),
      libs: this.libs,
    });
    this.clearConsole();
    const html = this.makePreviewHTML(
      this.els.html.getValue(),
      this.els.css.getValue(),
      this.els.js.getValue(),
      this.libs
    );
    // Use srcdoc for simplicity
    this.els.frame.srcdoc = html;
    this.updateStatus("Running");
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

export class LayoutManager {
  static DEFAULT_STATE = {
    itemA: {
      id: "itemA", // 제어
      content: `
          <div class="panel">
            <header class="grid-item-header">
              <div class="widget-title">WASM Playground( <span class="muted" id="status">Idle</span> ) </div>

              <div class="d-flex align-items-center">
                <input
                id="libUrl"
                type="text"
                placeholder="e.g. https://cdn.jsdelivr.net/npm/lodash-es@4/lodash.min.js"
                />
                <button class="btn" id="addLib">Add</button>
              </div>

              <div class="d-flex align-items-center">
                <button class="btn mini info" id="formatting" title="formatting codes">
                  <img src="/icons/tool.svg" alt="format_button" />
                </button>
                <button class="btn mini" id="runBtn" title="Run (Ctrl/Cmd+Enter)">
                  <img src="/icons/play.svg" alt="play_button" />
                </button>
                <button class="btn mini" id="resetBtn" title="Reset editors to starter">
                  <img src="/icons/trash.svg" alt="reset_button" />
                </button>              
              </div>
            </header>
          
            <div class="editor grid-item-body">
              <ul id="tabs" data-tabs>
                <li><a data-tabby-default href="#htmlCode">HTML</a></li>
                <li><a href="#cssCode">CSS</a></li>
                <li><a href="#jsCode">JS</a></li>
                <li><a href="#rustCode">RUST</a></li>
              </ul>

              <div class="tab-content" id="htmlCode"><textarea id="html" class="text-area" spellcheck="false"></textarea></div>
              <div class="tab-content" id="cssCode"><textarea id="css" class="text-area" spellcheck="false"></textarea></div>
              <div class="tab-content" id="jsCode"><textarea id="js" class="text-area" spellcheck="false"></textarea></div>
              <div class="tab-content" id="rustCode"><textarea id="rust" class="text-area" spellcheck="false"></textarea></div>
            </div>
          </div>
  `,
      x: 0,
      y: 0,
      w: 6,
      h: 5,
      minH: 3,
      minW: 3,
    },
    itemD: {
      id: "itemD",
      content: `  
          <div class="panel preview">
            <header class="grid-item-header"> 
              <div class="widget-title">Preview (sandboxed)</div>
            </header>
            <iframe
              class="grid-item-body"
              id="frame"
              sandbox="allow-scripts allow-modals allow-forms"
            ></iframe>
            <div class="console" id="console"></div>
          </div>`,
      x: 6,
      y: 0,
      w: 6,
      h: 5,
      minH: 3,
      minW: 3,
    },
  };

  constructor() {
    this.config = {
      float: false,
      margin: 2,
      column: 12,
      handle: ".grid-item-header",
      draggable: {
        handle: ".grid-item-header",
        cancel: ".grid-item-body", // 드래그 안하는 영역
      },
    };
    this.gridManager = GridStack.init(this.config);
    this.state = LayoutManager.DEFAULT_STATE;
  }

  addAjaxItemToGrid(state, useCompact = false) {
    const existing = document.querySelector(
      `.grid-stack-item[gs-id="${state.id}"]`
    );
    if (existing) return;

    const wrapper = document.createElement("div");
    wrapper.className = "grid-stack-item";
    wrapper.setAttribute("gs-id", state.id);

    const content = document.createElement("div");
    content.className = "grid-stack-item-content";
    const mountEle = document.createElement("div");
    mountEle.style.cssText = "height:100%; width:100%;";

    mountEle.innerHTML = state.content;
    content.appendChild(mountEle);
    wrapper.appendChild(content);

    this.gridManager.el.appendChild(wrapper);

    this.gridManager.makeWidget(wrapper, {
      w: state.w || 4,
      h: state.h || 2,
      x: state.x || 0,
      y: state.y || 0,
      minW: state.minW || 2,
      minH: state.minH || 2,
      id: state.id,
    });

    // if (useCompact) this.gridManager.compact();
  }

  init() {
    const contentArea = document.querySelector(".grid-stack");
    if (contentArea) {
      const scrollWidth = this.getScrollbarWidth();
      contentArea.setAttribute("style", `width: calc(100% - ${scrollWidth}px)`);
    }

    Object.values(this.state).forEach((item) => {
      this.addAjaxItemToGrid(item);
    });

    this.bindEvents();
  }

  bindEvents() {
    this.gridManager.on("resizestop", () => {
      this.gridManager.compact();
    });

    this.gridManager.on("change", () => {
      this.gridManager.compact();
    });
  }

  getScrollbarWidth() {
    // 임시 div 생성
    const outer = document.createElement("div");
    outer.style.visibility = "hidden";
    outer.style.overflow = "scroll";
    outer.style.msOverflowStyle = "scrollbar"; // IE 지원 일부
    outer.style.width = "100px";
    outer.style.height = "100px";
    document.body.appendChild(outer);

    // 내부 div 생성
    const inner = document.createElement("div");
    inner.style.width = "100%";
    inner.style.height = "100%";
    outer.appendChild(inner);

    // 스크롤바 두께 = offsetWidth - clientWidth
    const scrollbarWidth = outer.offsetWidth - inner.clientWidth;

    // 클린업
    document.body.removeChild(outer);

    return scrollbarWidth;
  }
}

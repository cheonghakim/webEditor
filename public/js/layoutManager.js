export class LayoutManager {
  static DEFAULT_STATE = {
    itemA: {
      id: "itemA", // 제어
      content: `
          <div class="panel">
            <header class="grid-item-header">
              <h2>CSS</h2>
            </header>
          
            <div class="editor grid-item-body">
              <!-- <pre class="gutter">1</pre> -->
              <textarea id="css" class="text-area" spellcheck="false"></textarea>
            </div>
          </div>
  `,
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      minH: 1,
      minW: 2,
    },
    itemB: {
      id: "itemB",
      content: `
          <div class="panel">
            <header class="grid-item-header">
              <h2>HTML</h2>
            </header>
          
            <div class="editor grid-item-body">
              <!-- <pre class="gutter">1</pre> -->
              <textarea id="html" class="text-area" spellcheck="false"></textarea>
            </div>
          </div>
        `,
      x: 0,
      y: 2,
      w: 6,
      h: 2,
      minH: 1,
      minW: 2,
    },
    itemC: {
      id: "itemC",
      content: ` 
          <div class="panel">
            <header class="grid-item-header">
              <h2>JavaScript</h2>
            </header>
            <div class="editor grid-item-body">
              <!-- <pre class="gutter">1</pre> -->
              <textarea id="js" class="text-area" spellcheck="false"></textarea>
            </div>
          </div>`,
      x: 0,
      y: 4,
      w: 6,
      h: 2,
      minH: 1,
      minW: 2,
    },
    itemE: {
      id: "itemE",
      content: ` 
          <div class="panel">
            <header class="grid-item-header">
              <h2>Rust</h2>
            </header>
            <div class="editor grid-item-body">
              <!-- <pre class="gutter">1</pre> -->
              <textarea id="rust" class="text-area" spellcheck="false"></textarea>
            </div>
          </div>`,
      x: 3,
      y: 0,
      w: 3,
      h: 2,
      minH: 1,
      minW: 2,
    },
    itemD: {
      id: "itemD",
      content: `  
          <div class="panel preview">
            <header class="grid-item-header"> 
              <h2>Preview (sandboxed)</h2>
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
      h: 6,
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

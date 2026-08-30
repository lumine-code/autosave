const fs = require("fs");
const { CompositeDisposable, Disposable, FileState } = require("lumine");
const { dontSaveIf, shouldSave } = require("./controls");

module.exports = {
  subscriptions: null,

  provideAutosave() {
    return { dontSaveIf };
  },

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.surfaceWindows = new Map();
    this.itemSurfaceSubscriptions = new Map();

    // One listener per native surface Window. Several pane items share the
    // primary surface, so ref-counting is what prevents one blur from saving
    // the same workspace once per item.
    this.retainSurfaceWindow(window);
    this.subscriptions.add(
      new Disposable(() => this.disposeSurfaceSubscriptions()),
      lumine.workspace.observePaneItems((item) => this.observeItemSurface(item)),
      lumine.workspace.onDidDestroyPaneItem(({ item }) => this.unobserveItemSurface(item)),
    );

    this.subscriptions.add(
      lumine.workspace.onDidAddPaneItem(({ item }) => this.autosavePaneItem(item, true)),
    );
    this.subscriptions.add(
      lumine.workspace.onWillDestroyPaneItem(({ item }) => this.autosavePaneItem(item)),
    );
  },

  deactivate() {
    this.subscriptions.dispose();
    return this.autosaveAllPaneItems();
  },

  observeItemSurface(item) {
    if (this.itemSurfaceSubscriptions.has(item)) return;
    const entry = { window: null, subscription: null };
    this.itemSurfaceSubscriptions.set(item, entry);
    entry.subscription = lumine.workspace.observePaneItemSurface(item, (surface) => {
      const domWindow = surface?.window || null;
      if (entry.window === domWindow) return;
      if (entry.window) this.releaseSurfaceWindow(entry.window);
      entry.window = domWindow;
      if (domWindow) this.retainSurfaceWindow(domWindow);
    });
  },

  unobserveItemSurface(item) {
    const entry = this.itemSurfaceSubscriptions.get(item);
    if (!entry) return;
    entry.subscription?.dispose();
    if (entry.window) this.releaseSurfaceWindow(entry.window);
    this.itemSurfaceSubscriptions.delete(item);
  },

  retainSurfaceWindow(domWindow) {
    let entry = this.surfaceWindows.get(domWindow);
    if (entry) {
      entry.references++;
      return;
    }
    const handleBlur = (event) => {
      if (event.target === domWindow) {
        this.autosaveAllPaneItems();
      } else if (event.target?.matches?.("lumine-text-editor:not([mini])")) {
        return this.autosavePaneItem(event.target.getModel());
      }
    };
    domWindow.addEventListener("blur", handleBlur, true);
    this.surfaceWindows.set(domWindow, { references: 1, handleBlur });
  },

  releaseSurfaceWindow(domWindow) {
    const entry = this.surfaceWindows.get(domWindow);
    if (!entry || --entry.references > 0) return;
    try {
      domWindow.removeEventListener("blur", entry.handleBlur, true);
    } catch {
      // A detached native Window may already be gone during crash recovery.
    }
    this.surfaceWindows.delete(domWindow);
  },

  disposeSurfaceSubscriptions() {
    for (const item of [...this.itemSurfaceSubscriptions.keys()]) {
      this.unobserveItemSurface(item);
    }
    for (const [domWindow, entry] of this.surfaceWindows) {
      try {
        domWindow.removeEventListener("blur", entry.handleBlur, true);
      } catch {
        // A detached native Window may already be gone during teardown.
      }
    }
    this.surfaceWindows.clear();
  },

  autosavePaneItem(paneItem, create = false) {
    if (!lumine.config.get("autosave.enabled")) return;
    if (!paneItem) return;
    if (!paneItem.getURI?.()) return;
    if (paneItem.getFileState?.() !== FileState.MODIFIED) return;
    if (!paneItem.getPath?.()) return;
    if (!shouldSave(paneItem)) return;

    try {
      const stats = fs.statSync(paneItem.getPath());
      if (!stats.isFile()) return;
    } catch (e) {
      if (e.code !== "ENOENT") return;
      if (!create) return;
    }

    const pane = lumine.workspace.paneForItem(paneItem);
    let promise = Promise.resolve();
    if (pane) {
      promise = pane.saveItem(paneItem);
    } else if (typeof paneItem.save === "function") {
      promise = paneItem.save();
    }
    return promise;
  },

  autosaveAllPaneItems() {
    return Promise.all(
      lumine.workspace.getPaneItems().map((paneItem) => this.autosavePaneItem(paneItem)),
    );
  },
};

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
    this.surfaceSubscriptions = new Map();

    this.subscriptions.add(
      new Disposable(() => this.disposeSurfaceSubscriptions()),
      lumine.workspace.observeWindowSurfaces((surface) => this.observeSurface(surface)),
      lumine.workspace.onDidRemoveWindowSurface((surface) => this.unobserveSurface(surface)),
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

  observeSurface(surface) {
    if (this.surfaceSubscriptions.has(surface)) return;
    const domWindow = surface.window;
    const handleBlur = (event) => {
      if (event.target === domWindow) {
        this.autosaveAllPaneItems();
      } else if (event.target?.matches?.("lumine-text-editor:not([mini])")) {
        return this.autosavePaneItem(event.target.getModel());
      }
    };
    domWindow.addEventListener("blur", handleBlur, true);
    this.surfaceSubscriptions.set(
      surface,
      new Disposable(() => {
        try {
          domWindow.removeEventListener("blur", handleBlur, true);
        } catch {
          // A detached native Window may already be gone during recovery.
        }
      }),
    );
  },

  unobserveSurface(surface) {
    const subscription = this.surfaceSubscriptions.get(surface);
    if (!subscription) return;
    this.surfaceSubscriptions.delete(surface);
    subscription.dispose();
  },

  disposeSurfaceSubscriptions() {
    for (const surface of [...this.surfaceSubscriptions.keys()]) this.unobserveSurface(surface);
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

const fs = require("fs");
const { CompositeDisposable, Disposable } = require("lumine");
const { dontSaveIf, shouldSave } = require("./controls");

module.exports = {
  subscriptions: null,

  provideAutosave() {
    return { dontSaveIf };
  },

  activate() {
    this.subscriptions = new CompositeDisposable();

    const handleBlur = (event) => {
      if (event.target === window) {
        this.autosaveAllPaneItems();
      } else if (event.target.matches("lumine-text-editor:not(mini)")) {
        return this.autosavePaneItem(event.target.getModel());
      }
    };

    window.addEventListener("blur", handleBlur, true);
    this.subscriptions.add(
      new Disposable(() => window.removeEventListener("blur", handleBlur, true)),
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

  autosavePaneItem(paneItem, create = false) {
    if (!lumine.config.get("autosave.enabled")) return;
    if (!paneItem) return;
    if (!paneItem.getURI?.()) return;
    if (!paneItem.isModified?.()) return;
    if (!paneItem.getPath?.()) return;
    if (paneItem.isInConflict?.()) return;
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

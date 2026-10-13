describe("autosave in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("autosave");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("autosave");
    await lumine.workspace.discardEditorWindows();
  });
  it("observes an auxiliary editor blur and removes its native listeners on attach", async () => {
    const editor = await lumine.workspace.open();
    const extra = await lumine.workspace.detachItem(editor, { show: false });
    const main = lumine.packages.getActivePackage("autosave").mainModule;
    const save = spyOn(main, "autosavePaneItem");
    const nativeWindow = extra.getDocument().defaultView;
    editor.getElement().dispatchEvent(new nativeWindow.FocusEvent("blur"));
    expect(save).toHaveBeenCalledWith(editor);
    await lumine.workspace.attachWindow(extra);
    save.calls.reset();
    nativeWindow.dispatchEvent(new nativeWindow.FocusEvent("blur"));
    expect(save).not.toHaveBeenCalled();
  });
});

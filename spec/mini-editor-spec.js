const fs = require("node:fs"),
  path = require("node:path");
describe("Autosave file editor blur scope", () => {
  let editor, file;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    lumine.config.set("autosave.enabled", true);
    await lumine.packages.activatePackage("autosave");
    file = path.join(lumine.getConfigDirPath(), "mini-blur-file.txt");
    fs.writeFileSync(file, "saved");
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("autosave");
    fs.unlinkSync(file);
  });
  for (const mini of [true, false]) {
    it(`${mini ? "skips a mini" : "saves a regular"} real editor with a path on blur`, async () => {
      editor = lumine.workspace.buildTextEditor({ mini });
      editor.getBuffer().setPath(file);
      editor.setText("changed");
      const element = lumine.views.getView(editor);
      lumine.workspace.getElement().appendChild(element);
      const save = spyOn(editor, "save").and.callThrough();
      element.dispatchEvent(new FocusEvent("blur"));
      if (mini) {
        if (save.calls.any()) await save.calls.mostRecent().returnValue;
        expect(save).not.toHaveBeenCalled();
        expect(fs.readFileSync(file, "utf8")).toBe("saved");
      } else {
        expect(save).toHaveBeenCalledTimes(1);
        await save.calls.mostRecent().returnValue;
        expect(fs.readFileSync(file, "utf8")).toBe("changed");
      }
    });
  }
});

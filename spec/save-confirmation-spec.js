const fs = require("fs");
const path = require("path");

describe("autosave with buffer save confirmation", () => {
  const confirmation = { message: "Allow changes to this example?" };
  const original = "original example\n";
  const changed = "changed example\n";
  const later = "later change\n";
  const fixtureRoot = path.resolve(__dirname, "fixtures");
  let main, directory, filePath, editor, editors, subscriptions, operations;

  beforeEach(async () => {
    jasmine.useRealClock();
    lumine.config.set("autosave.enabled", false);
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editors = [];
    subscriptions = [];
    operations = [];
    directory = fs.mkdtempSync(path.join(fixtureRoot, "autosave-confirmation-"));
    filePath = path.join(directory, "example.txt");
    fs.writeFileSync(filePath, original);
    editor = await lumine.workspace.open(filePath);
    editors.push(editor);
    await editor.getBuffer().getFileWatchStartPromise();
  });

  afterEach(async () => {
    lumine.config.set("autosave.enabled", false);
    lumine.notifications.clear();
    for (const subscription of subscriptions) subscription.dispose();
    for (const item of editors) item.destroy();
    await Promise.allSettled(operations);
    await lumine.packages.deactivatePackage("autosave");
    if (path.dirname(directory) !== fixtureRoot) throw new Error("Unexpected fixture directory");
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });

  function nextConfirmation() {
    return new Promise((resolve) => {
      const subscription = lumine.notifications.onDidAddNotification((notification) => {
        if (notification.getMessage() !== confirmation.message) return;
        subscription.dispose();
        resolve(notification);
      });
      subscriptions.push(subscription);
    });
  }

  function click(notification, text) {
    const button = notification.getOptions().buttons.find((item) => item.text === text);
    expect(button).toBeDefined();
    button.onDidClick();
  }

  async function chooseManualSave(choice, item = editor) {
    const next = nextConfirmation();
    const saving = item.save();
    saving.catch(() => {});
    operations.push(saving);
    const notification = await next;
    expect(notification.getOptions().buttons.map((button) => button.text)).toEqual([
      "Yes, remember",
      "Yes",
      "No",
    ]);
    click(notification, choice);
    if (choice === "No") await expectAsync(saving).toBeRejected();
    else await saving;
    return notification;
  }

  async function blur(item = editor) {
    const save = spyOn(main, "autosavePaneItem").and.callThrough();
    save.calls.reset();
    const element = item.getElement();
    element.dispatchEvent(new element.ownerDocument.defaultView.FocusEvent("blur"));
    expect(save).toHaveBeenCalledWith(item);
    await save.calls.mostRecent().returnValue;
  }

  it("skips an undecided protected buffer on blur without opening a warning", async () => {
    editor.setSaveConfirmation(confirmation);
    editor.setText(changed);
    lumine.config.set("autosave.enabled", true);
    const added = spyOn(lumine.notifications, "addWarning").and.callThrough();

    await blur();

    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
    expect(editor.getFileState()).toBe("modified");
    expect(added).not.toHaveBeenCalled();
  });

  it("leaves later automatic saves blocked after Yes permits one manual save", async () => {
    editor.setSaveConfirmation(confirmation);
    editor.setText(changed);
    await chooseManualSave("Yes");
    editor.setText(later);
    lumine.config.set("autosave.enabled", true);
    const added = spyOn(lumine.notifications, "addWarning").and.callThrough();

    await blur();

    expect(fs.readFileSync(filePath, "utf8")).toBe(changed);
    expect(editor.getText()).toBe(later);
    expect(editor.getFileState()).toBe("modified");
    expect(added).not.toHaveBeenCalled();
  });

  it("allows later blur saves after Yes, remember while still requiring global opt-in", async () => {
    editor.setSaveConfirmation(confirmation);
    editor.setText(changed);
    await chooseManualSave("Yes, remember");
    editor.setSaveConfirmation({ ...confirmation });
    expect(editor.canSaveAutomatically()).toBe(true);
    expect(editor.getSaveConfirmation()).toEqual(confirmation);
    expect(lumine.config.get("autosave.enabled")).toBe(false);
    editor.setText(later);
    const added = spyOn(lumine.notifications, "addWarning").and.callThrough();

    await blur();
    expect(fs.readFileSync(filePath, "utf8")).toBe(changed);
    lumine.config.set("autosave.enabled", true);
    await blur();

    expect(fs.readFileSync(filePath, "utf8")).toBe(later);
    expect(editor.getFileState()).toBe("unmodified");
    expect(added).not.toHaveBeenCalled();
  });

  it("keeps automatic saves silent after No cancels a manual attempt", async () => {
    editor.setSaveConfirmation(confirmation);
    editor.setText(changed);
    await chooseManualSave("No");
    lumine.config.set("autosave.enabled", true);
    const added = spyOn(lumine.notifications, "addWarning").and.callThrough();

    await blur();

    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
    expect(editor.getFileState()).toBe("modified");
    expect(added).not.toHaveBeenCalled();
  });

  it("saves unflagged buffers normally on blur", async () => {
    editor.setText(changed);
    lumine.config.set("autosave.enabled", true);
    const added = spyOn(lumine.notifications, "addWarning").and.callThrough();

    await blur();

    expect(fs.readFileSync(filePath, "utf8")).toBe(changed);
    expect(editor.getFileState()).toBe("unmodified");
    expect(added).not.toHaveBeenCalled();
  });

  it("shares the flag and Always approval between copies of the same buffer", async () => {
    editor.setSaveConfirmation(confirmation);
    editor.setText(changed);
    const copy = editor.copy();
    editors.push(copy);
    lumine.workspace.getActivePane().splitRight({ items: [copy] });
    expect(copy.getBuffer()).toBe(editor.getBuffer());
    expect(copy.getSaveConfirmation()).toEqual(confirmation);
    lumine.config.set("autosave.enabled", true);
    const added = spyOn(lumine.notifications, "addWarning").and.callThrough();
    await blur(copy);
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
    expect(added).not.toHaveBeenCalled();

    await chooseManualSave("Yes, remember", copy);
    editor.setSaveConfirmation({ ...confirmation });
    expect(editor.canSaveAutomatically()).toBe(true);
    expect(copy.canSaveAutomatically()).toBe(true);
    copy.setText(later);
    added.calls.reset();
    await blur(editor);

    expect(fs.readFileSync(filePath, "utf8")).toBe(later);
    expect(copy.getFileState()).toBe("unmodified");
    expect(added).not.toHaveBeenCalled();
  });

  it("keeps custom saveable items working and preserves unexpected write errors", async () => {
    const item = {
      getURI: () => filePath,
      getPath: () => filePath,
      getFileState: () => "modified",
      save: jasmine.createSpy("save").and.callFake(() => fs.promises.writeFile(filePath, changed)),
    };
    lumine.config.set("autosave.enabled", true);

    await main.autosavePaneItem(item);

    expect(fs.readFileSync(filePath, "utf8")).toBe(changed);
    const error = new Error("Unexpected write error");
    error.code = "EACCES";
    item.save.and.rejectWith(error);
    await expectAsync(main.autosavePaneItem(item)).toBeRejectedWith(error);
  });

  it("quietly consumes a cancelled save when the flag changes after preflight", async () => {
    editor.setText(changed);
    lumine.config.set("autosave.enabled", true);
    const pane = lumine.workspace.paneForItem(editor);
    const save = pane.saveItem;
    spyOn(pane, "saveItem").and.callFake(function (item) {
      item.setSaveConfirmation(confirmation);
      return save.call(this, item);
    });
    const error = spyOn(pane, "handleSaveError");
    const next = nextConfirmation();
    const saving = main.autosavePaneItem(editor);
    operations.push(saving);
    const notification = await next;
    click(notification, "No");

    await expectAsync(saving).toBeResolved();

    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
    expect(editor.getFileState()).toBe("modified");
    expect(error).not.toHaveBeenCalled();
  });
});
